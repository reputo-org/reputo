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
} from '../../shared/types/index.js';

/** Algorithm keys that are also DeepID score types (keys map 1:1 to types — no translation). */
const POSTABLE_SCORE_TYPES = new Set<ScoreType>([
  'voting_engagement',
  'contribution_score',
  'proposal_engagement',
  'token_value_over_time',
  'custom_score',
]);

/** Users posted per `POST /v1/clients/scores` call (sized defensively against request timeouts). */
const POST_CHUNK_SIZE = 500;

const EMPTY_RESULT: PostSnapshotScoresResult = { posted: 0, ok: 0, failed: 0, skipped: 0 };

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

/**
 * Posts a completed snapshot's primary score back to DeepID via
 * `POST /v1/clients/scores`. The score `type` is the algorithm key (keys map 1:1
 * to DeepID score types). `did` is posted verbatim and must be a valid DID;
 * non-DID rows are logged and skipped. Best-effort by design — the caller treats
 * a thrown error as non-fatal so a posting failure never fails the snapshot.
 */
export function createDeepIdPostScoresActivity(ctx: DeepIdSyncContext) {
  const { storage, storageConfig } = ctx;

  return async function post_snapshot_scores(input: PostSnapshotScoresInput): Promise<PostSnapshotScoresResult> {
    const { snapshot } = input;
    const logger = Context.current().log;
    const snapshotId = snapshot.id;
    const algorithmKey = snapshot.algorithmPresetFrozen.key;

    if (!POSTABLE_SCORE_TYPES.has(algorithmKey as ScoreType)) {
      logger.info('Algorithm is not a DeepID score type; skipping score post', { snapshotId, algorithmKey });
      return EMPTY_RESULT;
    }
    const scoreType = algorithmKey as ScoreType;

    const definition = JSON.parse(
      getAlgorithmDefinition({ key: algorithmKey, version: snapshot.algorithmPresetFrozen.version }),
    ) as AlgorithmDefinition;
    const primaryOutput = getPrimaryCsvOutput(definition);
    if (!primaryOutput) {
      logger.warn('Algorithm has no primary CSV output; skipping score post', { snapshotId, algorithmKey });
      return EMPTY_RESULT;
    }

    const csvKey = snapshot.outputs?.[primaryOutput.outputKey];
    if (typeof csvKey !== 'string' || csvKey.trim() === '') {
      logger.warn('Snapshot is missing the primary score output; skipping score post', {
        snapshotId,
        outputKey: primaryOutput.outputKey,
      });
      return EMPTY_RESULT;
    }

    const csvBuffer = await storage.getObject({ bucket: storageConfig.bucket, key: csvKey });
    const rows = parse(csvBuffer.toString('utf-8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Array<Record<string, string>>;

    const timestamp = snapshot.completedAt ?? new Date().toISOString();

    const scores: PostScoresRequest = {};
    let skipped = 0;
    for (const row of rows) {
      const did = row.did?.trim();
      const score = Number(row[primaryOutput.scoreColumnKey]);
      if (!isValidDid(did) || !Number.isFinite(score)) {
        skipped += 1;
        continue;
      }
      scores[did] = { score, type: scoreType, timestamp };
    }

    const entries = Object.entries(scores);
    if (entries.length === 0) {
      logger.warn('No postable DID-keyed scores in snapshot output; skipping score post', {
        snapshotId,
        algorithmKey,
        skipped,
      });
      return { ...EMPTY_RESULT, skipped };
    }

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

    let ok = 0;
    let failed = 0;
    const batches = chunk(entries, POST_CHUNK_SIZE);
    for (let i = 0; i < batches.length; i++) {
      const batch = Object.fromEntries(batches[i]) as PostScoresRequest;
      const response = await client.postScores(batch);
      ok += response.status.ok;
      failed += response.status.failed;

      for (const [did, result] of Object.entries(response.results)) {
        if (result.message !== 'OK') {
          logger.warn('DeepID rejected a score', { snapshotId, scoreType, did, message: result.message });
        }
      }
      Context.current().heartbeat({ batch: i + 1, totalBatches: batches.length });
    }

    logger.info('Posted snapshot scores to DeepID', {
      snapshotId,
      scoreType,
      posted: entries.length,
      ok,
      failed,
      skipped,
    });

    return { posted: entries.length, ok, failed, skipped };
  };
}

/** Worker-registerable activities object for posting snapshot scores to DeepID. */
export function createDeepIdPostScoresActivities(ctx: DeepIdSyncContext): DeepIdPostScoresActivities {
  return { postSnapshotScores: createDeepIdPostScoresActivity(ctx) };
}
