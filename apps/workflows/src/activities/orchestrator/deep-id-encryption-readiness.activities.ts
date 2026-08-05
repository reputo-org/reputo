import { createDeepIdClient, type DeepIdClient, DeepIdContractError, HttpError } from '@reputo/deep-id-api';
import { ApplicationFailure, Context } from '@temporalio/activity';

import config from '../../config/index.js';
import { DEEP_ID_ENCRYPTION_READINESS_FATAL_ERROR_TYPE } from '../../shared/errors/index.js';
import type {
  CheckEncryptionReadinessInput,
  CheckEncryptionReadinessResult,
  DeepIdEncryptionReadinessActivities,
  EncryptionReadinessCounts,
} from '../../shared/types/index.js';
import { parseCustomScoreChildren } from '../../shared/utils/index.js';
import {
  classifyEncryptedUser,
  EncryptedCohortViolation,
  resolveSelectedEncryptedChildren,
  type SelectedEncryptedChild,
} from './deep-id-encrypted-cohort.js';

/** DeepID rejects `pageSize` above 100 on `GET /v1/users`. */
const READINESS_PAGE_SIZE = 100;

/** Full-pass restarts allowed after cursor-expiry `400`s within one poll. */
const CURSOR_RESTART_LIMIT = 3;

class CursorExpiredError extends Error {
  constructor(readonly pagesSeen: number) {
    super('DeepID users cursor expired mid-pass');
    this.name = 'CursorExpiredError';
  }
}

function fatal(message: string, details: Record<string, unknown>): ApplicationFailure {
  return ApplicationFailure.nonRetryable(message, DEEP_ID_ENCRYPTION_READINESS_FATAL_ERROR_TYPE, details);
}

interface ReadinessPass {
  counts: EncryptionReadinessCounts;
  scannedUsers: number;
  pages: number;
}

async function scanUsers(
  client: DeepIdClient,
  selectedChildren: SelectedEncryptedChild[],
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
        counts[classifyEncryptedUser(did, user.scores_encr, selectedChildren).state] += 1;
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
  if (error instanceof EncryptedCohortViolation) {
    return fatal(error.message, error.details);
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
    let selectedChildren: SelectedEncryptedChild[];
    try {
      selectedChildren = resolveSelectedEncryptedChildren(children);
    } catch (error) {
      if (error instanceof EncryptedCohortViolation) {
        throw fatal(error.message, error.details);
      }
      throw error;
    }
    const tokenScopes = ['api', ...selectedChildren.map((child) => child.scope)].join(' ');

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
        const pass = await scanUsers(client, selectedChildren, tokenScopes, trackRequestId);
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
