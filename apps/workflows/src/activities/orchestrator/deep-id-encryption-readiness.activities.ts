import {
  createDeepIdClient,
  type DeepIdClient,
  DeepIdContractError,
  ENCRYPTED_SCORE_SCOPES,
  type EncryptedScoreScope,
  HttpError,
  parseEncryptedScores,
} from '@reputo/deep-id-api';
import { ApplicationFailure, Context } from '@temporalio/activity';

import config from '../../config/index.js';
import { DEEP_ID_ENCRYPTION_READINESS_FATAL_ERROR_TYPE } from '../../shared/errors/index.js';
import type {
  CheckEncryptionReadinessInput,
  CheckEncryptionReadinessResult,
  DeepIdEncryptionReadinessActivities,
  EncryptionReadinessCounts,
} from '../../shared/types/index.js';
import { type CustomScoreChild, parseCustomScoreChildren } from '../../shared/utils/index.js';

const READINESS_PAGE_SIZE = 1000;

/** Full-pass restarts allowed after cursor-expiry `400`s within one poll. */
const CURSOR_RESTART_LIMIT = 3;

const ENCRYPTED_SCOPE_SET = new Set<string>(ENCRYPTED_SCORE_SCOPES);

class CursorExpiredError extends Error {
  constructor(readonly pagesSeen: number) {
    super('DeepID users cursor expired mid-pass');
    this.name = 'CursorExpiredError';
  }
}

function fatal(message: string, details: Record<string, unknown>): ApplicationFailure {
  return ApplicationFailure.nonRetryable(message, DEEP_ID_ENCRYPTION_READINESS_FATAL_ERROR_TYPE, details);
}

function resolveEncryptedScopes(children: CustomScoreChild[]): EncryptedScoreScope[] {
  return children.map((child) => {
    const scope = `${child.algorithm_key}_encr`;
    if (!ENCRYPTED_SCOPE_SET.has(scope)) {
      throw fatal(`Child algorithm "${child.algorithm_key}" has no DeepID encrypted score scope`, {
        childKey: child.algorithm_key,
      });
    }
    return scope as EncryptedScoreScope;
  });
}

function classifyUser(
  did: string,
  scoresEncrValue: unknown,
  selectedScopes: EncryptedScoreScope[],
): keyof EncryptionReadinessCounts {
  let scoresEncr: ReturnType<typeof parseEncryptedScores>;
  try {
    scoresEncr = parseEncryptedScores(scoresEncrValue);
  } catch (error) {
    if (error instanceof DeepIdContractError) {
      throw fatal(`DeepID user "${did}" has malformed scores_encr: ${error.message}`, {
        did,
        issues: error.issues.map((issue) => issue.path),
      });
    }
    throw error;
  }

  // No scores_encr at all means every selected field is absent.
  if (scoresEncr === undefined) {
    return 'incomplete';
  }

  let pending = 0;
  for (const scope of selectedScopes) {
    const field = scoresEncr[scope];
    if (field === undefined || field === null) {
      return 'incomplete';
    }
    if (field.status === 'pending_encryption') {
      pending += 1;
    }
  }
  if (pending > 0) {
    return 'potentiallyComplete';
  }

  // A user with every selected ciphertext ready must reference metadata.
  if (scoresEncr['seal-metadata'] === null) {
    throw fatal(`DeepID user "${did}" has every selected child encrypted but no seal-metadata reference`, { did });
  }
  return 'complete';
}

interface ReadinessPass {
  counts: EncryptionReadinessCounts;
  scannedUsers: number;
  pages: number;
}

async function scanUsers(
  client: DeepIdClient,
  selectedScopes: EncryptedScoreScope[],
  tokenScopes: string,
  onRequestId: (requestId: string) => void,
): Promise<ReadinessPass> {
  const counts: EncryptionReadinessCounts = { complete: 0, potentiallyComplete: 0, incomplete: 0 };
  let scannedUsers = 0;
  let pages = 0;

  try {
    for await (const page of client.iterateUsers({
      pageSize: READINESS_PAGE_SIZE,
      filteredTokenScopes: tokenScopes,
    })) {
      pages += 1;
      if (page.requestId) {
        onRequestId(page.requestId);
      }
      for (const [did, user] of Object.entries(page.users)) {
        counts[classifyUser(did, user.scores_encr, selectedScopes)] += 1;
        scannedUsers += 1;
      }
      Context.current().heartbeat({ pages, scannedUsers });
    }
  } catch (error) {
    // A 400 after the first page is the 5-minute pagination cursor expiring.
    if (error instanceof HttpError && error.statusCode === 400 && pages > 0) {
      throw new CursorExpiredError(pages);
    }
    throw error;
  }

  return { counts, scannedUsers, pages };
}

function toReadinessFailure(error: unknown, snapshotId: string, lastRequestId: string | undefined): unknown {
  if (error instanceof ApplicationFailure) {
    return error;
  }
  if (error instanceof DeepIdContractError) {
    return fatal(`DeepID readiness response broke the contract: ${error.message}`, {
      snapshotId,
      issues: error.issues.map((issue) => issue.path),
      lastRequestId,
    });
  }
  if (error instanceof HttpError) {
    if (error.statusCode === 401) {
      return fatal('DeepID authentication failed during the encryption readiness poll', { snapshotId, lastRequestId });
    }
    if (error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
      return fatal(`DeepID rejected the encryption readiness read: HTTP ${error.statusCode}`, {
        snapshotId,
        statusCode: error.statusCode,
        lastRequestId,
      });
    }
  }
  return error;
}

/**
 * One encryption-readiness pass for a combined snapshot: scan every
 * `GET /v1/users` page and classify each unified user; ready only when no
 * potentially complete user remains. The result carries aggregate counts
 * only, so no ciphertext or DID can reach workflow state or history.
 */
export function createCheckEncryptionReadinessActivity() {
  return async function check_encryption_readiness(
    input: CheckEncryptionReadinessInput,
  ): Promise<CheckEncryptionReadinessResult> {
    const { snapshotId, algorithmPresetFrozen } = input;
    const logger = Context.current().log;

    const children = parseCustomScoreChildren(algorithmPresetFrozen.inputs);
    const selectedScopes = resolveEncryptedScopes(children);
    const tokenScopes = ['api', ...selectedScopes].join(' ');

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

    let lastRequestId: string | undefined;
    const trackRequestId = (requestId: string) => {
      lastRequestId = requestId;
    };

    for (let cursorRestarts = 0; ; cursorRestarts++) {
      try {
        const pass = await scanUsers(client, selectedScopes, tokenScopes, trackRequestId);
        const ready = pass.counts.potentiallyComplete === 0;

        logger.info('DeepID encryption readiness pass finished', {
          snapshotId,
          ready,
          ...pass.counts,
          scannedUsers: pass.scannedUsers,
          pages: pass.pages,
          cursorRestarts,
          lastRequestId,
        });

        return { ready, ...pass, cursorRestarts, lastRequestId };
      } catch (error) {
        if (error instanceof CursorExpiredError) {
          if (cursorRestarts < CURSOR_RESTART_LIMIT) {
            logger.warn('DeepID users cursor expired; discarding the partial pass and restarting from page 1', {
              snapshotId,
              pagesSeen: error.pagesSeen,
              cursorRestarts: cursorRestarts + 1,
              lastRequestId,
            });
            continue;
          }
          throw fatal(
            `DeepID users cursor expired on ${cursorRestarts + 1} consecutive passes: a full readiness pass cannot finish within the cursor lifetime`,
            { snapshotId, cursorRestarts: cursorRestarts + 1, lastRequestId },
          );
        }
        throw toReadinessFailure(error, snapshotId, lastRequestId);
      }
    }
  };
}

/** Worker-registerable activities object for the encryption-readiness poll. */
export function createDeepIdEncryptionReadinessActivities(): DeepIdEncryptionReadinessActivities {
  return { checkEncryptionReadiness: createCheckEncryptionReadinessActivity() };
}
