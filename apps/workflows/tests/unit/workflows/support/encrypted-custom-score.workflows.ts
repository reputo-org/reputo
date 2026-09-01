import type { ScoreType } from '@reputo/deep-id-api';
import { proxyActivities } from '@temporalio/workflow';
import type {
  AlgorithmPresetFrozen,
  DeepIdEncryptionReadinessActivities,
  DeepIdSubmitEncryptedScoresActivities,
  EncryptedChildObservation,
} from '../../../../src/shared/types/index.js';
import {
  type EncryptedCustomScoreLifecycleOutcome,
  runEncryptedCustomScoreLifecycle,
} from '../../../../src/workflows/encrypted-custom-score.js';

const { checkEncryptionReadiness } = proxyActivities<DeepIdEncryptionReadinessActivities>({
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 1 },
});

const { submitCustomEncryptedScores } = proxyActivities<DeepIdSubmitEncryptedScoresActivities>({
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 1 },
});

/** Test-only workflow: runs the production lifecycle loop against stubbed activities. */
export async function encryptedCustomScoreLifecycleWorkflow(input: {
  snapshotId: string;
  algorithmPresetFrozen: AlgorithmPresetFrozen;
  observations: EncryptedChildObservation[];
  skippedScoreTypes?: ScoreType[];
  timestamp: string;
}): Promise<EncryptedCustomScoreLifecycleOutcome> {
  return runEncryptedCustomScoreLifecycle({
    ...input,
    skippedScoreTypes: input.skippedScoreTypes ?? [],
    checkEncryptionReadiness,
    submitCustomEncryptedScores,
  });
}
