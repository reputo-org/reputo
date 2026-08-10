import {
  chunk,
  createDeepIdClient,
  type DeepIdClient,
  DeepIdContractError,
  HttpError,
  type PostScoresRequest,
  type SealMetadata,
  type UsersPage,
} from '@reputo/deep-id-api';
import { type AlgorithmDefinition, getAlgorithmDefinition } from '@reputo/reputation-algorithms';
import { ApplicationFailure, Context } from '@temporalio/activity';

import config from '../../config/index.js';
import { DEEP_ID_ENCRYPTED_SUBMISSION_FATAL_ERROR_TYPE, EncryptedCustomScoreError } from '../../shared/errors/index.js';
import type {
  DeepIdSubmitEncryptedScoresActivities,
  NormalizationObservation,
  SubmitCustomEncryptedScoresInput,
  SubmitCustomEncryptedScoresResult,
} from '../../shared/types/index.js';
import { parseCustomScoreChildren } from '../../shared/utils/index.js';
import {
  createEncryptedCustomScoreEvaluator,
  type EncryptedCustomScoreEvaluator,
  type EncryptedCustomScoreUser,
} from '../typescript/algorithms/custom-score/encrypted-evaluator/index.js';
import {
  classifyEncryptedUser,
  EncryptedCohortViolation,
  resolveSelectedEncryptedChildren,
  type SelectedEncryptedChild,
} from './deep-id-encrypted-cohort.js';

/**
 * Users per processing page. Deliberately far below the readiness pass's 1000:
 * a processing page holds every selected serialized ciphertext (hundreds of
 * kilobytes each), so this bounds page memory even with four selected children.
 */
const PROCESSING_PAGE_SIZE = 100;

/** Users per final `POST /v1/clients/scores` call — each entry carries a serialized ciphertext. */
const ENCRYPTED_POST_CHUNK_SIZE = 25;

/** Full-pass restarts allowed after cursor-expiry `400`s within one invocation. */
const CURSOR_RESTART_LIMIT = 3;

class CursorExpiredError extends Error {
  constructor(readonly pagesSeen: number) {
    super('DeepID users cursor expired mid-pass');
    this.name = 'CursorExpiredError';
  }
}

/** A potentially complete user has a pending selected field — stop the pass, return to readiness polling. */
class PendingEncryptionFoundError extends Error {
  constructor(readonly partialPass: ProcessingPassState) {
    super('A potentially complete user still has a selected score pending encryption');
    this.name = 'PendingEncryptionFoundError';
  }
}

function fatal(message: string, details: Record<string, unknown>): ApplicationFailure {
  return ApplicationFailure.nonRetryable(message, DEEP_ID_ENCRYPTED_SUBMISSION_FATAL_ERROR_TYPE, details);
}

function toSubmissionFailure(error: unknown, snapshotId: string, lastRequestId: string | undefined): unknown {
  if (error instanceof ApplicationFailure) {
    return error;
  }
  if (error instanceof EncryptedCohortViolation) {
    return fatal(error.message, error.details);
  }
  if (error instanceof EncryptedCustomScoreError) {
    return fatal(`Encrypted custom_score evaluation failed: ${error.message}`, {
      snapshotId,
      evaluationCode: error.evaluationCode,
      ...error.context,
    });
  }
  if (error instanceof DeepIdContractError) {
    return fatal(`DeepID encrypted submission response broke the contract: ${error.message}`, {
      snapshotId,
      issues: error.issues.map((issue) => issue.path),
      lastRequestId,
    });
  }
  if (error instanceof HttpError) {
    if (error.statusCode === 401) {
      return fatal('DeepID authentication failed during the encrypted submission pass', { snapshotId, lastRequestId });
    }
    if (error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
      return fatal(`DeepID rejected an encrypted submission request: HTTP ${error.statusCode}`, {
        snapshotId,
        statusCode: error.statusCode,
        lastRequestId,
      });
    }
  }
  return error;
}

/** Maps each selected child to its raw-submission observation; a mismatch is a caller error. */
function resolveObservations(
  selectedChildren: SelectedEncryptedChild[],
  observations: SubmitCustomEncryptedScoresInput['observations'],
): Map<string, NormalizationObservation> {
  const byScoreType = new Map<string, NormalizationObservation>();
  for (const entry of observations) {
    if (byScoreType.has(entry.scoreType)) {
      throw fatal(`Duplicate normalization observation for child "${entry.scoreType}"`, { childKey: entry.scoreType });
    }
    byScoreType.set(entry.scoreType, entry.observation);
  }
  for (const child of selectedChildren) {
    if (!byScoreType.has(child.key)) {
      throw fatal(`Child algorithm "${child.key}" has no normalization observation from the raw submission`, {
        childKey: child.key,
      });
    }
  }
  return byScoreType;
}

/** Running aggregates of one processing pass; page-local data never lives here. */
interface ProcessingPassState {
  complete: number;
  incomplete: number;
  scannedUsers: number;
  pages: number;
  submitted: number;
  batches: number;
}

interface ProcessingContext {
  client: DeepIdClient;
  evaluator: EncryptedCustomScoreEvaluator;
  selectedChildren: SelectedEncryptedChild[];
  readScopes: string;
  timestamp: string;
  /** Public SEAL metadata cached by its `scores_encr['seal-metadata']` URL for the activity lifetime. */
  metadataByUrl: Map<string, SealMetadata>;
  lastRequestId: string | undefined;
}

/**
 * Page reads, metadata reads, and posts can each spend minutes inside the
 * client's retry/backoff loop, and two of them back to back would outlive the
 * activity's 5-minute heartbeat timeout — so every network await is followed
 * by a heartbeat (the SDK throttles the actual RPCs).
 */
function heartbeatProgress(pass: ProcessingPassState): void {
  Context.current().heartbeat({ pages: pass.pages, scannedUsers: pass.scannedUsers, submitted: pass.submitted });
}

/** Registers the user's SEAL metadata with the evaluator (once per URL); returns the key id the final entry echoes. */
async function resolveUserKeyId(ctx: ProcessingContext, metadataUrl: string): Promise<string> {
  const cached = ctx.metadataByUrl.get(metadataUrl);
  if (cached) {
    return cached.id;
  }
  const metadata = await ctx.client.getSealMetadata(metadataUrl);
  ctx.evaluator.registerSealMetadata(metadata);
  ctx.metadataByUrl.set(metadataUrl, metadata);
  return metadata.id;
}

/** Every entry of every batch must return `OK`; any other per-user message is a final rejection and fails the run. */
async function submitPage(
  ctx: ProcessingContext,
  pageUsers: EncryptedCustomScoreUser[],
  pass: ProcessingPassState,
): Promise<void> {
  const results = ctx.evaluator.evaluateBatch(pageUsers);

  for (const batch of chunk(results, ENCRYPTED_POST_CHUNK_SIZE)) {
    const request: PostScoresRequest = Object.fromEntries(
      batch.map((result) => [
        result.did,
        {
          ciphertext: result.ciphertext,
          keyId: result.keyId,
          type: 'custom_score_encr' as const,
          timestamp: ctx.timestamp,
        },
      ]),
    );

    const response = await ctx.client.postScores(request);
    ctx.lastRequestId = response.requestId ?? ctx.lastRequestId;

    for (const result of batch) {
      const message = response.results[result.did]?.message;
      if (message !== 'OK') {
        throw fatal(
          `DeepID rejected the final custom_score_encr entry for a complete user: ${message ?? 'no per-user result returned'}`,
          { did: result.did, message: message ?? null, lastRequestId: ctx.lastRequestId },
        );
      }
    }

    pass.submitted += batch.length;
    pass.batches += 1;
    heartbeatProgress(pass);
  }
}

/**
 * One full processing pass: classify every unified user page by page,
 * evaluate the complete ones, and submit their final entries. Throws
 * `PendingEncryptionFoundError` as soon as any potentially complete user has
 * a pending selected field — before that user's page is evaluated or posted —
 * and `CursorExpiredError` when the pagination cursor expires mid-pass.
 */
async function runProcessingPass(ctx: ProcessingContext): Promise<ProcessingPassState> {
  const pass: ProcessingPassState = {
    complete: 0,
    incomplete: 0,
    scannedUsers: 0,
    pages: 0,
    submitted: 0,
    batches: 0,
  };

  const pages = ctx.client
    .iterateUsers({ pageSize: PROCESSING_PAGE_SIZE, filteredTokenScopes: ctx.readScopes })
    [Symbol.asyncIterator]();

  for (;;) {
    let next: IteratorResult<UsersPage, void>;
    try {
      next = await pages.next();
    } catch (error) {
      // A 400 after the first page is the 5-minute pagination cursor expiring;
      // a 400 from metadata reads or posting never reaches this catch.
      if (error instanceof HttpError && error.statusCode === 400 && pass.pages > 0) {
        throw new CursorExpiredError(pass.pages);
      }
      throw error;
    }
    if (next.done) {
      break;
    }

    const page = next.value;
    pass.pages += 1;
    ctx.lastRequestId = page.requestId ?? ctx.lastRequestId;
    heartbeatProgress(pass);

    // The whole page is classified before anything is evaluated or posted, so
    // a pending user stops its page from submitting at all.
    const pageUsers: EncryptedCustomScoreUser[] = [];
    for (const [did, user] of Object.entries(page.users)) {
      pass.scannedUsers += 1;
      const classification = classifyEncryptedUser(did, user.scores_encr, ctx.selectedChildren);
      if (classification.state === 'incomplete') {
        pass.incomplete += 1;
        continue;
      }
      if (classification.state === 'potentiallyComplete') {
        throw new PendingEncryptionFoundError(pass);
      }
      pass.complete += 1;
      const keyId = await resolveUserKeyId(ctx, classification.metadataUrl);
      pageUsers.push({ did, keyId, ciphertexts: classification.ciphertexts });
      heartbeatProgress(pass);
    }

    if (pageUsers.length > 0) {
      await submitPage(ctx, pageUsers, pass);
    }
    heartbeatProgress(pass);
  }

  return pass;
}

/**
 * Evaluates and submits a combined (`custom_score`) snapshot's final encrypted
 * scores after a full ready readiness pass. One invocation runs bounded
 * processing passes over `GET /v1/users`: complete users (every selected field
 * `encrypted`) are homomorphically evaluated and their `custom_score_encr`
 * entries posted under the caller's fixed run timestamp; incomplete users are
 * excluded without zero-filling. A pending selected field stops the pass and
 * returns `pending_encryption` so the workflow can resume readiness polling.
 *
 * Cursor expiry discards page-local state and restarts from page 1 — safe
 * because DeepID dedups identical logical entries and timestamps, so entries
 * accepted before the expiry are simply reposted. Every complete-user entry
 * must return `OK`; a rejection, malformed metadata, an incompatible
 * ciphertext, or an evaluator failure fails the run. Results and logs carry
 * aggregate counts and request ids only — never ciphertext bodies.
 */
export function createSubmitCustomEncryptedScoresActivity() {
  return async function submit_custom_encrypted_scores(
    input: SubmitCustomEncryptedScoresInput,
  ): Promise<SubmitCustomEncryptedScoresResult> {
    const { snapshotId, algorithmPresetFrozen, observations, timestamp } = input;
    const logger = Context.current().log;

    const definition = JSON.parse(
      getAlgorithmDefinition({ key: algorithmPresetFrozen.key, version: algorithmPresetFrozen.version }),
    ) as AlgorithmDefinition;
    if (definition.kind !== 'combined') {
      throw fatal(`submitCustomEncryptedScores supports only combined snapshots, got "${definition.key}"`, {
        snapshotId,
        algorithmKey: definition.key,
      });
    }
    // An unknown method fails inside the evaluator's strategy registry, not here.
    const method = definition.normalization?.method ?? 'observed_min_max';

    const children = parseCustomScoreChildren(algorithmPresetFrozen.inputs);
    let selectedChildren: SelectedEncryptedChild[];
    try {
      selectedChildren = resolveSelectedEncryptedChildren(children);
    } catch (error) {
      if (error instanceof EncryptedCohortViolation) {
        throw fatal(error.message, error.details);
      }
      throw error;
    }
    const observationsByChild = resolveObservations(selectedChildren, observations);
    // `filteredTokenScopes` must stay a subset of the token's scopes.
    const readScopes = ['api', ...selectedChildren.map((child) => child.scope)].join(' ');
    const tokenScopes = `${readScopes} post_scores`;

    const client = createDeepIdClient({
      identityBaseUrl: config.deepId.identityBaseUrl,
      appBaseUrl: config.deepId.appBaseUrl,
      clientId: config.deepId.clientId,
      clientSecret: config.deepId.clientSecret,
      scopes: tokenScopes,
      requestTimeoutMs: config.deepId.requestTimeoutMs,
      concurrency: config.deepId.concurrency,
      retry: {
        maxAttempts: config.deepId.retryMaxAttempts,
        baseDelayMs: config.deepId.retryBaseDelayMs,
        maxDelayMs: config.deepId.retryMaxDelayMs,
      },
      logLevel: config.logger.level,
    });

    let evaluator: EncryptedCustomScoreEvaluator;
    try {
      evaluator = await createEncryptedCustomScoreEvaluator({
        method,
        children: children.map((child) => ({
          key: child.algorithm_key,
          weight: child.weight,
          // resolveObservations guarantees one observation per selected child.
          observation: observationsByChild.get(child.algorithm_key) as NormalizationObservation,
        })),
      });
    } catch (error) {
      // Plan building fails deterministically (weights, method, observations),
      // so retrying the activity could never succeed.
      throw toSubmissionFailure(error, snapshotId, undefined);
    }

    const ctx: ProcessingContext = {
      client,
      evaluator,
      selectedChildren,
      readScopes,
      timestamp,
      metadataByUrl: new Map(),
      lastRequestId: undefined,
    };

    try {
      for (let cursorRestarts = 0; ; cursorRestarts++) {
        try {
          const pass = await runProcessingPass(ctx);
          const result: SubmitCustomEncryptedScoresResult = {
            outcome: 'submitted',
            complete: pass.complete,
            incomplete: pass.incomplete,
            scannedUsers: pass.scannedUsers,
            pages: pass.pages,
            cursorRestarts,
            submitted: pass.submitted,
            batches: pass.batches,
            registeredKeys: evaluator.stats().registeredKeys,
            lastRequestId: ctx.lastRequestId,
          };

          logger.info('Submitted final encrypted custom scores to DeepID', { snapshotId, ...result });
          return result;
        } catch (error) {
          if (error instanceof PendingEncryptionFoundError) {
            const diagnostics = { ...error.partialPass, cursorRestarts, lastRequestId: ctx.lastRequestId };
            logger.info('Encrypted processing pass found a pending selected score; returning to readiness polling', {
              snapshotId,
              ...diagnostics,
            });
            return {
              outcome: 'pending_encryption',
              complete: diagnostics.complete,
              incomplete: diagnostics.incomplete,
              scannedUsers: diagnostics.scannedUsers,
              pages: diagnostics.pages,
              cursorRestarts,
              lastRequestId: ctx.lastRequestId,
            };
          }
          if (error instanceof CursorExpiredError) {
            if (cursorRestarts < CURSOR_RESTART_LIMIT) {
              logger.warn('DeepID users cursor expired; discarding page-local state and restarting from page 1', {
                snapshotId,
                pagesSeen: error.pagesSeen,
                cursorRestarts: cursorRestarts + 1,
                lastRequestId: ctx.lastRequestId,
              });
              continue;
            }
            throw fatal(
              `DeepID users cursor expired on ${cursorRestarts + 1} consecutive passes: a full processing pass cannot finish within the cursor lifetime`,
              { snapshotId, cursorRestarts: cursorRestarts + 1, lastRequestId: ctx.lastRequestId },
            );
          }
          throw toSubmissionFailure(error, snapshotId, ctx.lastRequestId);
        }
      }
    } finally {
      evaluator.dispose();
    }
  };
}

/** Worker-registerable activities object for the final encrypted submission path. */
export function createDeepIdSubmitEncryptedScoresActivities(): DeepIdSubmitEncryptedScoresActivities {
  return { submitCustomEncryptedScores: createSubmitCustomEncryptedScoresActivity() };
}
