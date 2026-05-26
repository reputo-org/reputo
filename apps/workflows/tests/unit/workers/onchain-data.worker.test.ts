import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@temporalio/worker', () => ({
  NativeConnection: {
    connect: vi.fn(),
  },
  Worker: {
    create: vi.fn(),
  },
}));

vi.mock('../../../src/activities/onchain-data/index.js', () => ({
  createOnchainDataDependencyResolverActivities: vi.fn(() => ({})),
}));

vi.mock('../../../src/shared/utils/index.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

const ORIGINAL_ENV = process.env;
const BASE_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
  TEMPORAL_ADDRESS: 'localhost:7233',
  TEMPORAL_NAMESPACE: 'default',
  TEMPORAL_ORCHESTRATOR_TASK_QUEUE: 'orchestrator-worker',
  TEMPORAL_ALGORITHM_TYPESCRIPT_TASK_QUEUE: 'algorithm-typescript-worker',
  TEMPORAL_ALGORITHM_PYTHON_TASK_QUEUE: 'algorithm-python-worker',
  TEMPORAL_ONCHAIN_DATA_TASK_QUEUE: 'onchain-data-worker',
  AWS_REGION: 'eu-central-1',
  STORAGE_BUCKET: 'reputo-test',
  DEEPFUNDING_API_BASE_URL: 'https://api.deepfunding.xyz',
  DEEPFUNDING_API_KEY: 'test-deepfunding-key',
  ONCHAIN_DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/reputo_onchain_test',
  ALCHEMY_API_KEY: 'test-alchemy-key',
  BLOCKFROST_API_KEY: 'test-blockfrost-key',
};

describe('onchain-data worker module', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, ...BASE_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.resetModules();
  });

  it('loads with the full env and exposes the worker bootstrap', async () => {
    const workerModule = await import('../../../src/workers/typescript/onchain-data.worker.js');

    expect(typeof workerModule.runOnchainDataWorker).toBe('function');
  });

  it('fails to load when ALCHEMY_API_KEY is missing (caught by env schema)', async () => {
    delete process.env.ALCHEMY_API_KEY;

    await expect(import('../../../src/workers/typescript/onchain-data.worker.js')).rejects.toThrow(/ALCHEMY_API_KEY/);
  });

  it('fails to load when BLOCKFROST_API_KEY is missing (caught by env schema)', async () => {
    delete process.env.BLOCKFROST_API_KEY;

    await expect(import('../../../src/workers/typescript/onchain-data.worker.js')).rejects.toThrow(
      /BLOCKFROST_API_KEY/,
    );
  });
});
