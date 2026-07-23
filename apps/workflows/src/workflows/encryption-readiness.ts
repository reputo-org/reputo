import * as workflow from '@temporalio/workflow';

import {
  DEEP_ID_ENCRYPTION_DEADLINE_MS,
  DEEP_ID_READINESS_POLL_DELAYS_MS,
  DEEP_ID_READINESS_STEADY_POLL_DELAY_MS,
} from '../shared/constants/index.js';
import { DEEP_ID_ENCRYPTION_TIMEOUT_ERROR_TYPE } from '../shared/errors/index.js';
import type {
  AlgorithmPresetFrozen,
  CheckEncryptionReadinessResult,
  DeepIdEncryptionReadinessActivities,
  EncryptionReadinessCounts,
} from '../shared/types/index.js';

export interface EncryptionReadinessPollInput {
  snapshotId: string;
  algorithmPresetFrozen: AlgorithmPresetFrozen;
  /** The proxied readiness activity — injected so the caller owns its Temporal options. */
  checkEncryptionReadiness: DeepIdEncryptionReadinessActivities['checkEncryptionReadiness'];
  /**
   * Workflow-time deadline (ms since epoch) anchored at raw-score submission.
   * Re-entries after a pending processing pass pass it explicitly so the
   * 24-hour deadline never restarts; when absent it is derived from now.
   */
  deadlineAtMs?: number;
}

export interface EncryptionReadinessPollOutcome {
  counts: EncryptionReadinessCounts;
  pollCount: number;
  /** Workflow time elapsed between raw submission and readiness. */
  elapsedMs: number;
  /** Workflow-time offset of every poll since raw submission, in poll order. */
  polledAtOffsetsMs: number[];
  lastRequestId?: string;
}

/**
 * Waits on durable Temporal timers until every selected child score is ready
 * for encrypted evaluation; at the 24-hour deadline it fails the run with a
 * non-retryable `DEEPID_ENCRYPTION_TIMEOUT` failure instead. Timers and the
 * deadline derive from workflow history, so replay and worker restarts never
 * reset the schedule.
 */
export async function pollForEncryptionReadiness(
  input: EncryptionReadinessPollInput,
): Promise<EncryptionReadinessPollOutcome> {
  const { snapshotId, algorithmPresetFrozen, checkEncryptionReadiness } = input;

  // Date.now() is the deterministic workflow clock inside the sandbox.
  const submittedAtMs = Date.now();
  const deadlineAtMs = input.deadlineAtMs ?? submittedAtMs + DEEP_ID_ENCRYPTION_DEADLINE_MS;
  const polledAtOffsetsMs: number[] = [];

  for (;;) {
    const pollIndex = polledAtOffsetsMs.length;
    const delayMs = DEEP_ID_READINESS_POLL_DELAYS_MS[pollIndex] ?? DEEP_ID_READINESS_STEADY_POLL_DELAY_MS;
    await workflow.sleep(Math.min(delayMs, deadlineAtMs - Date.now()));

    const pass: CheckEncryptionReadinessResult = await checkEncryptionReadiness({ snapshotId, algorithmPresetFrozen });
    const elapsedMs = Date.now() - submittedAtMs;
    polledAtOffsetsMs.push(elapsedMs);

    workflow.log.info('DeepID encryption readiness poll finished', {
      snapshotId,
      poll: polledAtOffsetsMs.length,
      ready: pass.ready,
      ...pass.counts,
      scannedUsers: pass.scannedUsers,
      pages: pass.pages,
      cursorRestarts: pass.cursorRestarts,
      lastRequestId: pass.lastRequestId,
      elapsedMs,
    });

    if (pass.ready) {
      return {
        counts: pass.counts,
        pollCount: polledAtOffsetsMs.length,
        elapsedMs,
        polledAtOffsetsMs,
        lastRequestId: pass.lastRequestId,
      };
    }

    if (Date.now() >= deadlineAtMs) {
      const { complete, potentiallyComplete, incomplete } = pass.counts;
      throw workflow.ApplicationFailure.create({
        message:
          `DEEPID_ENCRYPTION_TIMEOUT: selected child scores were not ready for encrypted evaluation within 24 hours of raw submission ` +
          `(complete=${complete}, potentiallyComplete=${potentiallyComplete}, incomplete=${incomplete}, ` +
          `polls=${polledAtOffsetsMs.length}, elapsedMs=${elapsedMs}, lastRequestId=${pass.lastRequestId ?? 'none'})`,
        type: DEEP_ID_ENCRYPTION_TIMEOUT_ERROR_TYPE,
        nonRetryable: true,
        details: [
          {
            snapshotId,
            counts: pass.counts,
            pollCount: polledAtOffsetsMs.length,
            elapsedMs,
            lastRequestId: pass.lastRequestId,
          },
        ],
      });
    }
  }
}
