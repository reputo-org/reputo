import { proxyActivities } from '@temporalio/workflow';
import type { AlgorithmPresetFrozen, DeepIdEncryptionReadinessActivities } from '../../../../src/shared/types/index.js';
import {
  type EncryptionReadinessPollOutcome,
  pollForEncryptionReadiness,
} from '../../../../src/workflows/encryption-readiness.js';

const { checkEncryptionReadiness } = proxyActivities<DeepIdEncryptionReadinessActivities>({
  startToCloseTimeout: '1 minute',
  retry: { maximumAttempts: 1 },
});

/** Test-only workflow: runs the production polling loop against stubbed readiness passes. */
export async function encryptionReadinessPollWorkflow(input: {
  snapshotId: string;
  algorithmPresetFrozen: AlgorithmPresetFrozen;
}): Promise<EncryptionReadinessPollOutcome> {
  return pollForEncryptionReadiness({ ...input, checkEncryptionReadiness });
}
