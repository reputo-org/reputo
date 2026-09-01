import type { ScoreType } from '@reputo/deep-id-api';
import * as workflow from '@temporalio/workflow';

import { DEEP_ID_ENCRYPTION_DEADLINE_MS } from '../shared/constants/index.js';
import type {
  AlgorithmPresetFrozen,
  DeepIdEncryptionReadinessActivities,
  DeepIdSubmitEncryptedScoresActivities,
  EncryptedChildObservation,
  EncryptedScoresSubmittedResult,
} from '../shared/types/index.js';
import { type EncryptionReadinessPollOutcome, pollForEncryptionReadiness } from './encryption-readiness.js';

export interface EncryptedCustomScoreLifecycleInput {
  snapshotId: string;
  algorithmPresetFrozen: AlgorithmPresetFrozen;
  /** Per-child observations from the raw submission's accepted rows. */
  observations: EncryptedChildObservation[];
  /** Children the raw submission skipped; excluded from readiness and aggregation. */
  skippedScoreTypes: ScoreType[];
  /** The fixed run timestamp — the same value every raw entry used. */
  timestamp: string;
  /** The proxied activities — injected so the caller owns their Temporal options. */
  checkEncryptionReadiness: DeepIdEncryptionReadinessActivities['checkEncryptionReadiness'];
  submitCustomEncryptedScores: DeepIdSubmitEncryptedScoresActivities['submitCustomEncryptedScores'];
}

export interface EncryptedCustomScoreLifecycleOutcome {
  /** The readiness poll that preceded the successful processing pass. */
  readiness: EncryptionReadinessPollOutcome;
  submission: EncryptedScoresSubmittedResult;
  /** Poll → process rounds run, including the successful one. */
  rounds: number;
}

/**
 * Drives a combined snapshot from raw-score submission to accepted final
 * `custom_score_encr` entries: poll readiness on durable timers, then run one
 * encrypted processing pass. A pass that finds a pending selected field
 * returns to readiness polling; the 24-hour encryption deadline stays
 * anchored at raw submission (this function's entry) across every round, so a
 * regression can never extend it. Resolves only when a processing pass has
 * submitted every complete user's final entry with `OK`.
 */
export async function runEncryptedCustomScoreLifecycle(
  input: EncryptedCustomScoreLifecycleInput,
): Promise<EncryptedCustomScoreLifecycleOutcome> {
  const { snapshotId, algorithmPresetFrozen, observations, skippedScoreTypes, timestamp } = input;

  // Date.now() is the deterministic workflow clock inside the sandbox.
  const deadlineAtMs = Date.now() + DEEP_ID_ENCRYPTION_DEADLINE_MS;

  for (let rounds = 1; ; rounds++) {
    const readiness = await pollForEncryptionReadiness({
      snapshotId,
      algorithmPresetFrozen,
      skippedScoreTypes,
      checkEncryptionReadiness: input.checkEncryptionReadiness,
      deadlineAtMs,
    });

    workflow.log.info('DeepID encrypted child scores are ready for evaluation', {
      snapshotId,
      round: rounds,
      ...readiness.counts,
      pollCount: readiness.pollCount,
      elapsedMs: readiness.elapsedMs,
      lastRequestId: readiness.lastRequestId,
    });

    const submission = await input.submitCustomEncryptedScores({
      snapshotId,
      algorithmPresetFrozen,
      observations,
      skippedScoreTypes,
      timestamp,
    });

    if (submission.outcome === 'submitted') {
      return { readiness, submission, rounds };
    }

    // Entries accepted during the stopped pass are safely resubmitted later:
    // the logical identity and run timestamp never change.
    workflow.log.warn('Encrypted processing pass found a pending selected score; resuming readiness polling', {
      snapshotId,
      round: rounds,
      scannedUsers: submission.scannedUsers,
      pages: submission.pages,
      cursorRestarts: submission.cursorRestarts,
      lastRequestId: submission.lastRequestId,
    });
  }
}
