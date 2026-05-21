import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('workflows config', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, ...BASE_ENV };
    delete process.env.ALCHEMY_API_KEY;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.resetModules();
  });

  it('loads the shared config with on-chain data in the default export', async () => {
    const configModule = await import('../../../src/config/index.js');

    expect(configModule.default.temporal.onchainDataTaskQueue).toBe('onchain-data-worker');
    expect(configModule.default.storage.bucket).toBe('reputo-test');
    expect(configModule.default).not.toHaveProperty('mongoDB');
    expect(configModule.default.onchainData).toEqual({
      host: 'localhost',
      port: '5432',
      user: 'postgres',
      password: 'postgres',
      dbName: 'reputo_onchain_test',
      uri: 'postgresql://postgres:postgres@localhost:5432/reputo_onchain_test',
      alchemyApiKey: undefined,
      blockfrostAPIKey: undefined,
    });
  });

  it('rejects missing required on-chain PostgreSQL env vars during shared config load', async () => {
    delete process.env.ONCHAIN_DATA_POSTGRES_PORT;

    await expect(import('../../../src/config/index.js')).rejects.toThrow(/ONCHAIN_DATA_POSTGRES_PORT/);
  });

  it('builds the shared on-chain config from PostgreSQL env vars when alchemy is present', async () => {
    process.env.ALCHEMY_API_KEY = 'test-alchemy-key';
    const configModule = await import('../../../src/config/index.js');

    expect(configModule.default.onchainData).toEqual({
      host: 'localhost',
      port: '5432',
      user: 'postgres',
      password: 'postgres',
      dbName: 'reputo_onchain_test',
      uri: 'postgresql://postgres:postgres@localhost:5432/reputo_onchain_test',
      alchemyApiKey: 'test-alchemy-key',
      blockfrostAPIKey: undefined,
    });
  });
});
