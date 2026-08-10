import { chunk, createDeepIdClient, type PostScoresRequest, type ScoreType } from '@reputo/deep-id-api';
import {
  type AlgorithmDefinition,
  type AlgorithmNormalizationMethod,
  getAlgorithmDefinition,
} from '@reputo/reputation-algorithms';
import { Context } from '@temporalio/activity';
import { parse } from 'csv-parse/sync';

import config from '../../config/index.js';
import type {
  CustomRawScoresChildResult,
  DeepIdSubmitCustomScoresActivities,
  DeepIdSyncContext,
  NormalizationObservation,
  SubmitCustomRawScoresInput,
  SubmitCustomRawScoresResult,
} from '../../shared/types/index.js';
import { type CustomScoreChild, getPrimaryCsvOutput, parseCustomScoreChildren } from '../../shared/utils/index.js';

/**
 * Child algorithm keys that are also DeepID score types. `custom_score` itself
 * is never posted raw — the `custom_score_encr` aggregate is submitted later.
 */
const CHILD_SCORE_TYPES = new Set<ScoreType>([
  'voting_engagement',
  'contribution_score',
  'proposal_engagement',
  'token_value_over_time',
]);

/** Users posted per `POST /v1/clients/scores` call (sized defensively against request timeouts). */
const POST_CHUNK_SIZE = 500;

/** Output key of the compute stage's details artifact this activity extends. */
const DETAILS_OUTPUT_KEY = 'custom_score_details';

/** DeepID's rejection for a user who has not consented to Reputo — expected, counted as `dropped`. */
const EXPECTED_DROP_MESSAGE = 'User not found';

/** One native CSV row, posted verbatim by DID. */
interface RawScoreRow {
  did: string;
  score: number;
}

interface ResolvedChild {
  child: CustomScoreChild;
  scoreType: ScoreType;
  csvKey: string;
  scoreColumnKey: string;
}

/** Accumulates one child's accepted (`OK`) raw scores for the active normalization method. */
interface NormalizationObserver {
  accept(score: number): void;
  /** Observation over the accepted cohort, or `null` when nothing was accepted. */
  finish(): NormalizationObservation | null;
}

function createObservedMinMaxObserver(): NormalizationObserver {
  let min: number | null = null;
  let max: number | null = null;
  return {
    accept(score) {
      min = min === null || score < min ? score : min;
      max = max === null || score > max ? score : max;
    },
    finish() {
      return min === null || max === null ? null : { method: 'observed_min_max', min, max };
    },
  };
}

/** Observation collectors by normalization method; extend to support a new method. */
const OBSERVER_FACTORIES: Record<AlgorithmNormalizationMethod, () => NormalizationObserver> = {
  observed_min_max: createObservedMinMaxObserver,
};

function resolveNormalizationMethod(definition: AlgorithmDefinition): AlgorithmNormalizationMethod {
  // Definitions without normalization metadata default to observed min–max.
  const method = definition.normalization?.method ?? 'observed_min_max';
  if (!(method in OBSERVER_FACTORIES)) {
    throw new Error(`Unsupported normalization method: ${String(method)}`);
  }
  return method;
}

/** Resolves each selected child's score type, native CSV key, and native score column before anything is posted. */
function resolveChildren(
  children: CustomScoreChild[],
  outputs: SubmitCustomRawScoresInput['outputs'],
): ResolvedChild[] {
  return children.map((child) => {
    if (!CHILD_SCORE_TYPES.has(child.algorithm_key as ScoreType)) {
      throw new Error(`Child algorithm "${child.algorithm_key}" is not a DeepID score type`);
    }

    const childDefinition = JSON.parse(
      getAlgorithmDefinition({ key: child.algorithm_key, version: child.algorithm_version }),
    ) as AlgorithmDefinition;
    const { scoreColumnKey } = getPrimaryCsvOutput(childDefinition);

    const csvKey = outputs[child.algorithm_key];
    if (typeof csvKey !== 'string' || csvKey.trim() === '') {
      throw new Error(`Child algorithm "${child.algorithm_key}" has no native CSV output to submit`);
    }

    return { child, scoreType: child.algorithm_key as ScoreType, csvKey, scoreColumnKey };
  });
}

/**
 * Every row is posted, so a malformed one fails the run before any batch of
 * this child is sent: a missing or duplicate DID and a non-finite score are
 * malformed child artifacts, not rows to skip.
 */
function parseNativeScoreRows(csvText: string, childKey: string, scoreColumnKey: string): RawScoreRow[] {
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Array<Record<string, string>>;

  const seen = new Set<string>();
  const parsed: RawScoreRow[] = [];

  for (const row of rows) {
    const did = row.did?.trim();
    if (!did) {
      throw new Error(`Child algorithm "${childKey}" result is missing a did value`);
    }
    if (seen.has(did)) {
      throw new Error(`Child algorithm "${childKey}" result contains duplicate did "${did}"`);
    }
    seen.add(did);

    const rawScore = row[scoreColumnKey];
    // Number('') is 0 — an empty score cell is a malformed artifact, not a zero.
    const score = rawScore === undefined || rawScore === '' ? Number.NaN : Number(rawScore);
    if (!Number.isFinite(score)) {
      throw new Error(`Child algorithm "${childKey}" result contains a non-finite score for "${did}"`);
    }

    parsed.push({ did, score });
  }

  return parsed;
}

/**
 * Submits a combined (`custom_score`) snapshot's raw child scores to DeepID
 * before the snapshot completes, and collects each child's normalization
 * observation from the accepted rows. Each selected child posts exactly its
 * native CSV rows verbatim by DID under its own score type: no parent-DID
 * filtering, no cross-child joins, and no synthesized rows — a native zero is
 * a real row like any other. The caller supplies the run-consistent timestamp,
 * so Temporal retries repost identical logical entries and DeepID dedups them.
 *
 * Unlike the best-effort `postSnapshotScores` path, failures here are fatal:
 * transport/authentication errors, malformed responses, and non-finite raw
 * scores all fail the run. A child whose accepted cohort ends empty does not:
 * it returns a `null` observation and later stages exclude it from the
 * encrypted aggregation — only every child ending empty fails the run.
 * Expected per-user consent rejections are excluded from the observation and
 * counted as `dropped`; only aggregate counts and request IDs are logged.
 */
export function createSubmitCustomRawScoresActivity(ctx: DeepIdSyncContext) {
  const { storage, storageConfig } = ctx;

  return async function submit_custom_raw_scores(
    input: SubmitCustomRawScoresInput,
  ): Promise<SubmitCustomRawScoresResult> {
    const { snapshotId, algorithmPresetFrozen, outputs, timestamp } = input;
    const logger = Context.current().log;

    const definition = JSON.parse(
      getAlgorithmDefinition({ key: algorithmPresetFrozen.key, version: algorithmPresetFrozen.version }),
    ) as AlgorithmDefinition;
    if (definition.kind !== 'combined') {
      throw new Error(`submitCustomRawScores supports only combined snapshots, got "${definition.key}"`);
    }

    const method = resolveNormalizationMethod(definition);
    const children = parseCustomScoreChildren(algorithmPresetFrozen.inputs);
    const resolvedChildren = resolveChildren(children, outputs);

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

    const results: CustomRawScoresChildResult[] = [];

    for (const { child, scoreType, csvKey, scoreColumnKey } of resolvedChildren) {
      const csvBuffer = await storage.getObject({ bucket: storageConfig.bucket, key: csvKey });
      const rows = parseNativeScoreRows(csvBuffer.toString('utf-8'), child.algorithm_key, scoreColumnKey);

      const observer = OBSERVER_FACTORIES[method]();
      let ok = 0;
      let dropped = 0;
      let rejected = 0;
      let lastRequestId: string | undefined;

      const batches = chunk(rows, POST_CHUNK_SIZE);
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const request: PostScoresRequest = Object.fromEntries(
          batch.map((row) => [row.did, { score: row.score, type: scoreType, timestamp }]),
        );
        const response = await client.postScores(request);
        lastRequestId = response.requestId ?? lastRequestId;

        for (const row of batch) {
          const message = response.results[row.did]?.message;
          if (message === 'OK') {
            observer.accept(row.score);
            ok += 1;
          } else if (message === EXPECTED_DROP_MESSAGE) {
            dropped += 1;
          } else {
            rejected += 1;
          }
        }
        Context.current().heartbeat({ scoreType, batch: i + 1, totalBatches: batches.length });
      }

      const observation = observer.finish();
      if (observation === null) {
        logger.warn('Child algorithm has no accepted raw scores; skipping it in the encrypted aggregation', {
          snapshotId,
          scoreType,
          posted: rows.length,
          dropped,
          rejected,
          batches: batches.length,
          lastRequestId,
        });
      } else {
        logger.info('Submitted native child scores to DeepID', {
          snapshotId,
          scoreType,
          posted: rows.length,
          ok,
          dropped,
          rejected,
          batches: batches.length,
          lastRequestId,
        });
      }

      results.push({ scoreType, csvKey, observation, posted: rows.length, ok, dropped, rejected, lastRequestId });
    }

    if (results.every((result) => result.observation === null)) {
      const counts = results
        .map(
          (result) =>
            `${result.scoreType}: posted=${result.posted}, dropped=${result.dropped}, rejected=${result.rejected}`,
        )
        .join('; ');
      throw new Error(`No child algorithm produced an accepted raw score; nothing to aggregate (${counts})`);
    }

    await appendSubmissionDetails({ storage, storageConfig, outputs, children, results, logger });

    return { children: results };
  };
}

/** Deterministic per attempt, so a Temporal retry simply rewrites the same artifact. */
async function appendSubmissionDetails(args: {
  storage: DeepIdSyncContext['storage'];
  storageConfig: DeepIdSyncContext['storageConfig'];
  outputs: SubmitCustomRawScoresInput['outputs'];
  children: CustomScoreChild[];
  results: CustomRawScoresChildResult[];
  logger: ReturnType<typeof Context.current>['log'];
}): Promise<void> {
  const { storage, storageConfig, outputs, children, results, logger } = args;

  const detailsKey = outputs[DETAILS_OUTPUT_KEY];
  if (typeof detailsKey !== 'string' || detailsKey.trim() === '') {
    return;
  }

  const resultsByType = new Map(results.map((result) => [result.scoreType as string, result]));
  const effectiveTotalWeight = children.reduce(
    (sum, child) => (resultsByType.get(child.algorithm_key)?.observation ? sum + child.weight : sum),
    0,
  );

  const buffer = await storage.getObject({ bucket: storageConfig.bucket, key: detailsKey });
  const details = JSON.parse(buffer.toString('utf-8')) as {
    children?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };

  details.children = (details.children ?? []).map((entry) => {
    const result = resultsByType.get(String(entry.algorithm_key));
    if (!result) {
      return entry;
    }
    const { posted, ok, dropped, rejected, observation } = result;
    return { ...entry, submission: { posted, ok, dropped, rejected, observation } };
  });
  details.skipped_children = results.filter((result) => result.observation === null).map((result) => result.scoreType);
  details.effective_total_weight = Math.round(effectiveTotalWeight * 10 ** 6) / 10 ** 6;

  await storage.putObject({
    bucket: storageConfig.bucket,
    key: detailsKey,
    body: JSON.stringify(details, null, 2),
    contentType: 'application/json',
  });

  logger.info('Extended custom score details with submission outcomes', {
    detailsKey,
    skippedChildren: details.skipped_children,
    effectiveTotalWeight: details.effective_total_weight,
  });
}

/** Worker-registerable activities object for the custom raw-score submission path. */
export function createDeepIdSubmitCustomScoresActivities(ctx: DeepIdSyncContext): DeepIdSubmitCustomScoresActivities {
  return { submitCustomRawScores: createSubmitCustomRawScoresActivity(ctx) };
}
