import { beforeAll, describe, expect, it } from 'vitest';
import { SnapshotStatus } from '../../../src/shared/constants/index.js';
import { UnsupportedAlgorithmError } from '../../../src/shared/errors/index.js';
import type { Snapshot } from '../../../src/shared/types/index.js';

describe('dispatchAlgorithm activity', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'info';
    process.env.TEMPORAL_ADDRESS = 'localhost:7233';
    process.env.TEMPORAL_NAMESPACE = 'default';
    process.env.TEMPORAL_ORCHESTRATOR_TASK_QUEUE = 'orchestrator-worker';
    process.env.TEMPORAL_ALGORITHM_TYPESCRIPT_TASK_QUEUE = 'algorithm-typescript-worker';
    process.env.TEMPORAL_ALGORITHM_PYTHON_TASK_QUEUE = 'algorithm-python-worker';
    process.env.TEMPORAL_ONCHAIN_DATA_TASK_QUEUE = 'onchain-data-worker';
    process.env.AWS_REGION = 'us-east-1';
    process.env.STORAGE_BUCKET = 'reputo-test-bucket';
    process.env.DEEPFUNDING_API_BASE_URL = 'https://api.deepfunding.xyz';
    process.env.DEEPFUNDING_API_KEY = 'test-deepfunding-key';
    process.env.ONCHAIN_DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/reputo_onchain_test';
    process.env.ALCHEMY_API_KEY = 'test-alchemy-key';
    process.env.BLOCKFROST_API_KEY = 'test-blockfrost-key';
  });

  it('throws UnsupportedAlgorithmError for unknown algorithm keys', async () => {
    const { dispatchAlgorithm } = await import('../../../src/activities/typescript/dispatchAlgorithm.activity.js');
    const run = dispatchAlgorithm({} as never);

    const snapshot: Snapshot = {
      id: '019063b1-1234-7000-8000-000000000001',
      status: SnapshotStatus.queued,
      algorithmPresetId: '019063b1-1234-7000-8000-000000000002',
      algorithmPresetFrozen: {
        key: 'does_not_exist',
        version: '1.0.0',
        inputs: [],
      },
      createdAt: '2026-05-21T00:00:00.000Z',
      updatedAt: '2026-05-21T00:00:00.000Z',
    };

    await expect(run(snapshot)).rejects.toBeInstanceOf(UnsupportedAlgorithmError);
  });
});
