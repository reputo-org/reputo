import { chunk, createDeepIdClient, isValidDid, type PostScoresRequest, type ScoreType } from '@reputo/deep-id-api';
import { type AlgorithmDefinition, type CsvIoItem, getAlgorithmDefinition } from '@reputo/reputation-algorithms';
import { Context } from '@temporalio/activity';
import { parse } from 'csv-parse/sync';

import config from '../../config/index.js';
import type {
  DeepIdPostScoresActivities,
  DeepIdSyncContext,
  PostSnapshotScoresInput,
  PostSnapshotScoresResult,
  Snapshot,
} from '../../shared/types/index.js';

/**
 * Algorithm keys that are also DeepID score types (keys map 1:1 to types — no
 * translation). `custom_score` itself is never posted: a combined snapshot
 * submits each child's native raw scores through the dedicated
 * `submitCustomRawScores` path before it completes.
 */
const POSTABLE_SCORE_TYPES = new Set<ScoreType>([
  'voting_engagement',
  'contribution_score',
  'proposal_engagement',
  'token_value_over_time',
  'github_engagement',
  'discord_engagement',
  'mattermost_engagement',
]);

/** Users posted per `POST /v1/clients/scores` call (sized defensively against request timeouts). */
const POST_CHUNK_SIZE = 500;

/** DeepID's rejection for a user who has not consented to Reputo — expected, counted as `dropped`. */
const EXPECTED_DROP_MESSAGE = 'User not found';

const UNEXPECTED_REJECTION_WARN_LIMIT = 20;

const EMPTY_RESULT: PostSnapshotScoresResult = {
  attempted: false,
  posted: 0,
  ok: 0,
  failed: 0,
  dropped: 0,
  skipped: 0,
};

/** One score CSV to post under one DeepID score type. */
interface ScoreSource {
  scoreType: ScoreType;
  csvKey: string;
  scoreColumnKey: string;
}

function isCsvOutput(output: unknown): output is CsvIoItem {
  return (
    typeof output === 'object' &&
    output !== null &&
    (output as { type?: unknown }).type === 'csv' &&
    typeof (output as { csv?: unknown }).csv === 'object'
  );
}

/** The primary score CSV output: a CSV with a `did` column plus one score column. */
function getPrimaryCsvOutput(definition: AlgorithmDefinition): { outputKey: string; scoreColumnKey: string } | null {
  const csvOutput = definition.outputs.find(isCsvOutput);
  if (!csvOutput) {
    return null;
  }
  const scoreColumn = csvOutput.csv.columns?.find((column) => column.key !== 'did');
  if (!scoreColumn) {
    return null;
  }
  return { outputKey: csvOutput.key, scoreColumnKey: scoreColumn.key };
}

/** The standalone snapshot's primary CSV, posted under the algorithm's own key. */
function collectStandaloneSource(snapshot: Snapshot, definition: AlgorithmDefinition): ScoreSource[] {
  const logger = Context.current().log;
  const snapshotId = snapshot.id;
  const algorithmKey = snapshot.algorithmPresetFrozen.key;

  if (!POSTABLE_SCORE_TYPES.has(algorithmKey as ScoreType)) {
    logger.info('Algorithm is not a DeepID score type; skipping score post', { snapshotId, algorithmKey });
    return [];
  }

  const primaryOutput = getPrimaryCsvOutput(definition);
  if (!primaryOutput) {
    logger.warn('Algorithm has no primary CSV output; skipping score post', { snapshotId, algorithmKey });
    return [];
  }

  const csvKey = snapshot.outputs?.[primaryOutput.outputKey];
  if (typeof csvKey !== 'string' || csvKey.trim() === '') {
    logger.warn('Snapshot is missing the primary score output; skipping score post', {
      snapshotId,
      outputKey: primaryOutput.outputKey,
    });
    return [];
  }

  return [{ scoreType: algorithmKey as ScoreType, csvKey, scoreColumnKey: primaryOutput.scoreColumnKey }];
}

/**
 * Posts a completed standalone snapshot's primary CSV back to DeepID via
 * `POST /v1/clients/scores` under the snapshot's own algorithm key. Combined
 * (`custom_score`) snapshots are skipped: their native child scores are
 * submitted by the fatal `submitCustomRawScores` path before completion. `did`
 * is posted verbatim and must be a valid DID; non-DID rows are logged and
 * skipped. Best-effort by design — the caller treats a thrown error as
 * non-fatal so a posting failure never fails the snapshot.
 */
export function createDeepIdPostScoresActivity(ctx: DeepIdSyncContext) {
  const { storage, storageConfig } = ctx;

  return async function post_snapshot_scores(input: PostSnapshotScoresInput): Promise<PostSnapshotScoresResult> {
    const { snapshot } = input;
    const logger = Context.current().log;
    const snapshotId = snapshot.id;
    const algorithmKey = snapshot.algorithmPresetFrozen.key;

    const definition = JSON.parse(
      getAlgorithmDefinition({ key: algorithmKey, version: snapshot.algorithmPresetFrozen.version }),
    ) as AlgorithmDefinition;

    if (definition.kind === 'combined') {
      logger.info('Combined snapshot scores are submitted by the custom raw-score path; skipping score post', {
        snapshotId,
      });
      return EMPTY_RESULT;
    }

    const sources = collectStandaloneSource(snapshot, definition);
    if (sources.length === 0) {
      return EMPTY_RESULT;
    }

    // The workflow passes its run-consistent timestamp (the workflow start
    // time), so a retried post reuses the same value and DeepID dedupes on
    // `(did, type, timestamp)`. The fallbacks only cover legacy callers.
    const timestamp = input.timestamp ?? snapshot.completedAt ?? new Date().toISOString();
    const client = createDeepIdClient({
      identityBaseUrl: config.deepId.identityBaseUrl,
      appBaseUrl: config.deepId.appBaseUrl,
      clientId: config.deepId.clientId,
      clientSecret: config.deepId.clientSecret,
      scopes: config.deepId.scopes,
      requestTimeoutMs: config.deepId.requestTimeoutMs,
      concurrency: config.deepId.concurrency,
      retry: {
        maxAttempts: config.deepId.retryMaxAttempts,
        baseDelayMs: config.deepId.retryBaseDelayMs,
        maxDelayMs: config.deepId.retryMaxDelayMs,
      },
      logLevel: config.logger.level,
    });

    const totals: PostSnapshotScoresResult = { ...EMPTY_RESULT, attempted: true };
    let warnsLogged = 0;

    for (const source of sources) {
      const { scoreType, csvKey, scoreColumnKey } = source;
      const csvBuffer = await storage.getObject({ bucket: storageConfig.bucket, key: csvKey });
      const rows = parse(csvBuffer.toString('utf-8'), {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
      }) as Array<Record<string, string>>;

      const scores: PostScoresRequest = {};
      let skipped = 0;
      for (const row of rows) {
        const did = row.did?.trim();
        const rawScore = row[scoreColumnKey];
        // Number('') is 0 — skip empty score cells instead of posting zeros.
        const score = rawScore === undefined || rawScore === '' ? Number.NaN : Number(rawScore);
        if (!isValidDid(did) || !Number.isFinite(score)) {
          skipped += 1;
          continue;
        }
        scores[did] = { score, type: scoreType, timestamp };
      }
      totals.skipped += skipped;

      const entries = Object.entries(scores);
      if (entries.length === 0) {
        logger.warn('No postable DID-keyed scores in snapshot output; skipping score post', {
          snapshotId,
          scoreType,
          skipped,
        });
        continue;
      }

      let ok = 0;
      let failed = 0;
      let dropped = 0;
      const batches = chunk(entries, POST_CHUNK_SIZE);
      for (let i = 0; i < batches.length; i++) {
        const batch = Object.fromEntries(batches[i]) as PostScoresRequest;
        const response = await client.postScores(batch);
        ok += response.status.ok;

        for (const [did, result] of Object.entries(response.results)) {
          if (result.message === 'OK') {
            continue;
          }
          if (result.message === EXPECTED_DROP_MESSAGE) {
            dropped += 1;
            continue;
          }
          failed += 1;
          if (warnsLogged < UNEXPECTED_REJECTION_WARN_LIMIT) {
            warnsLogged += 1;
            logger.warn('DeepID rejected a score', { snapshotId, scoreType, did, message: result.message });
          }
        }
        Context.current().heartbeat({ scoreType, batch: i + 1, totalBatches: batches.length });
      }

      totals.posted += entries.length;
      totals.ok += ok;
      totals.failed += failed;
      totals.dropped += dropped;

      logger.info('Posted snapshot scores to DeepID', {
        snapshotId,
        scoreType,
        posted: entries.length,
        ok,
        failed,
        dropped,
        skipped,
      });
    }

    if (totals.failed > warnsLogged) {
      logger.warn('Further unexpected DeepID rejections were not logged individually', {
        snapshotId,
        failed: totals.failed,
        logged: warnsLogged,
      });
    }

    return totals;
  };
}

/** Worker-registerable activities object for posting snapshot scores to DeepID. */
export function createDeepIdPostScoresActivities(ctx: DeepIdSyncContext): DeepIdPostScoresActivities {
  return { postSnapshotScores: createDeepIdPostScoresActivity(ctx) };
}
