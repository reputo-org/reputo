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
  DEEPFUNDING_API_KEY: 'test-deepfunding-key',
  ONCHAIN_DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/reputo_onchain_test',
  ALCHEMY_API_KEY: 'test-alchemy-key',
  BLOCKFROST_API_KEY: 'test-blockfrost-key',
  DEEPID_IDENTITY_BASE_URL: 'https://identity.staging.deep-id.ai',
  DEEPID_APP_BASE_URL: 'https://app.staging.deep-id.ai',
  DEEPID_CLIENT_ID: 'test-deepid-client',
  DEEPID_CLIENT_SECRET: 'test-deepid-secret',
};

describe('workflows config', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, ...BASE_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.resetModules();
  });

  it('loads the shared config with on-chain data in the default export', async () => {
    const configModule = await import('../../../src/config/index.js');

    expect(configModule.default.temporal.onchainDataTaskQueue).toBe('onchain-data-worker');
    expect(configModule.default.storage.bucket).toBe('reputo-test');
    expect(configModule.default.onchainData).toEqual({
      uri: 'postgresql://postgres:postgres@localhost:5432/reputo_onchain_test',
      alchemyApiKey: 'test-alchemy-key',
      blockfrostAPIKey: 'test-blockfrost-key',
    });
    expect(configModule.default.deepId).toMatchObject({
      identityBaseUrl: 'https://identity.staging.deep-id.ai',
      appBaseUrl: 'https://app.staging.deep-id.ai',
      clientId: 'test-deepid-client',
      clientSecret: 'test-deepid-secret',
      scopes: 'api wallets post_scores',
    });
  });

  it('rejects a missing ONCHAIN_DATABASE_URL during shared config load', async () => {
    delete process.env.ONCHAIN_DATABASE_URL;

    await expect(import('../../../src/config/index.js')).rejects.toThrow(/ONCHAIN_DATABASE_URL/);
  });

  it('rejects a non-postgres ONCHAIN_DATABASE_URL scheme', async () => {
    process.env.ONCHAIN_DATABASE_URL = 'mysql://user:pass@localhost:3306/db';

    await expect(import('../../../src/config/index.js')).rejects.toThrow(/postgresql|postgres/);
  });

  it('rejects a missing ALCHEMY_API_KEY during shared config load', async () => {
    delete process.env.ALCHEMY_API_KEY;

    await expect(import('../../../src/config/index.js')).rejects.toThrow(/ALCHEMY_API_KEY/);
  });

  it('rejects a missing BLOCKFROST_API_KEY during shared config load', async () => {
    delete process.env.BLOCKFROST_API_KEY;

    await expect(import('../../../src/config/index.js')).rejects.toThrow(/BLOCKFROST_API_KEY/);
  });

  it('rejects an empty DEEPFUNDING_API_KEY (closes audit M4 empty-string-secret hole)', async () => {
    process.env.DEEPFUNDING_API_KEY = '';

    await expect(import('../../../src/config/index.js')).rejects.toThrow(/DEEPFUNDING_API_KEY/);
  });
});
