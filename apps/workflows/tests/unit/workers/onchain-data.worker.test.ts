import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@temporalio/worker', () => ({
  NativeConnection: {
    connect: vi.fn(),
  },
  Worker: {
    create: vi.fn(),
  },
}));

vi.mock('../../../src/activities/orchestrator/index.js', () => ({
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
  DEEPFUNDING_API_KEY: '',
  ONCHAIN_DATA_POSTGRES_HOST: 'localhost',
  ONCHAIN_DATA_POSTGRES_PORT: '5432',
  ONCHAIN_DATA_POSTGRES_USER: 'postgres',
  ONCHAIN_DATA_POSTGRES_PASSWORD: 'postgres',
  ONCHAIN_DATA_POSTGRES_DB_NAME: 'reputo_onchain_test',
};

describe('onchain-data worker config', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, ...BASE_ENV };
    delete process.env.ALCHEMY_API_KEY;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.resetModules();
  });

  it('requires ALCHEMY_API_KEY for the onchain-data worker', async () => {
    const workerModule = await import('../../../src/workers/typescript/onchain-data.worker.js');

    expect(() => workerModule.getOnchainDataWorkerConfig()).toThrow(/ALCHEMY_API_KEY/);
  });

  it('requires BLOCKFROST_API_KEY for the onchain-data worker', async () => {
    process.env.ALCHEMY_API_KEY = 'test-alchemy-key';
    const workerModule = await import('../../../src/workers/typescript/onchain-data.worker.js');

    expect(() => workerModule.getOnchainDataWorkerConfig()).toThrow(/BLOCKFROST_API_KEY/);
  });

  it('returns the worker runtime config when ALCHEMY_API_KEY and BLOCKFROST_API_KEY are present', async () => {
    process.env.ALCHEMY_API_KEY = 'test-alchemy-key';
    process.env.BLOCKFROST_API_KEY = 'test-blockfrost-api-key';
    const workerModule = await import('../../../src/workers/typescript/onchain-data.worker.js');

    expect(workerModule.getOnchainDataWorkerConfig()).toEqual({
      alchemyApiKey: 'test-alchemy-key',
      blockfrostAPIKey: 'test-blockfrost-api-key',
      databaseUrl: 'postgresql://postgres:postgres@localhost:5432/reputo_onchain_test',
    });
  });
});
