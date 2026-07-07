import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDeepfundingSync = vi.fn().mockResolvedValue({ outputs: {} });
const mockOnchainDataSync = vi.fn().mockResolvedValue(undefined);
const mockDeepIdSync = vi.fn().mockResolvedValue({ didsKey: 'snapshots/snapshot-1/deep-id/dids.json' });

vi.mock('../../../src/activities/orchestrator/deepfunding-portal-api.activities.js', () => ({
  createDeepfundingSyncActivity: vi.fn(() => mockDeepfundingSync),
}));

vi.mock('../../../src/activities/orchestrator/deep-id.activities.js', () => ({
  createDeepIdSyncActivity: vi.fn(() => mockDeepIdSync),
}));

vi.mock('../../../src/activities/onchain-data/onchain-data.activities.js', () => ({
  createOnchainDataSyncActivity: vi.fn(() => mockOnchainDataSync),
}));

vi.mock('@temporalio/activity', () => ({
  Context: {
    current: () => ({
      log: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      },
    }),
  },
}));

import type { Storage } from '@reputo/storage';
import { createOnchainDataDependencyResolverActivities } from '../../../src/activities/onchain-data/index.js';
import { createOrchestratorDependencyResolverActivities } from '../../../src/activities/orchestrator/dependency.activities.js';
import type { OrchestratorDependencyResolverContext } from '../../../src/shared/types/index.js';

describe('Dependency Resolver Activities', () => {
  const orchestratorCtx: OrchestratorDependencyResolverContext = {
    storage: {} as Storage,
    storageConfig: { bucket: 'test-bucket', maxSizeBytes: 1024 },
  };

  const onchainCtx = {
    databaseUrl: 'postgresql://postgres:postgres@localhost:5432/reputo_onchain_test',
    alchemyApiKey: 'test-alchemy-key',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should dispatch deepfunding-portal-api to deepfunding sync', async () => {
    const activities = createOrchestratorDependencyResolverActivities(orchestratorCtx);

    await activities.resolveDependency({
      dependencyKey: 'deepfunding-portal-api',
      snapshotId: 'snapshot-1',
    });

    expect(mockDeepfundingSync).toHaveBeenCalledWith({ snapshotId: 'snapshot-1' });
    expect(mockOnchainDataSync).not.toHaveBeenCalled();
  });

  it('should dispatch deep-id to the DeepID sync and return the generated dids key', async () => {
    const activities = createOrchestratorDependencyResolverActivities(orchestratorCtx);

    const result = await activities.resolveDependency({
      dependencyKey: 'deep-id',
      snapshotId: 'snapshot-1',
    });

    expect(mockDeepIdSync).toHaveBeenCalledWith({ snapshotId: 'snapshot-1' });
    expect(result).toEqual({ didsKey: 'snapshots/snapshot-1/deep-id/dids.json' });
    expect(mockOnchainDataSync).not.toHaveBeenCalled();
  });

  it('should dispatch onchain-data to onchain data sync', async () => {
    const activities = createOnchainDataDependencyResolverActivities(onchainCtx);

    await activities.resolveDependency({
      dependencyKey: 'onchain-data',
      snapshotId: 'snapshot-1',
    });

    expect(mockOnchainDataSync).toHaveBeenCalledOnce();
    expect(mockDeepfundingSync).not.toHaveBeenCalled();
  });

  it('should reject unexpected keys on the onchain-data worker', async () => {
    const activities = createOnchainDataDependencyResolverActivities(onchainCtx);

    await expect(
      activities.resolveDependency({
        dependencyKey: 'deepfunding-portal-api',
        snapshotId: 'snapshot-1',
      }),
    ).rejects.toThrow(/unexpected dependency/);
  });
});
