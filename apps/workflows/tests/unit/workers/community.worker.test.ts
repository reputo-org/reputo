import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMUNITY_WORKER_MAX_CONCURRENT_ACTIVITIES } from '../../../src/shared/constants/index.js';

vi.mock('@temporalio/worker', () => ({
  NativeConnection: {
    connect: vi.fn(),
  },
  Worker: {
    create: vi.fn(),
  },
}));

vi.mock('../../../src/activities/community/index.js', () => ({
  createCommunityDependencyResolverActivities: vi.fn(() => ({})),
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
  TEMPORAL_COMMUNITY_TASK_QUEUE: 'community-worker',
  AWS_REGION: 'eu-central-1',
  STORAGE_BUCKET: 'reputo-test',
  DEEPFUNDING_API_BASE_URL: 'https://api.deepfunding.xyz',
  DEEPFUNDING_API_KEY: 'test-deepfunding-key',
  ONCHAIN_DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/reputo_onchain_test',
  ALCHEMY_API_KEY: 'test-alchemy-key',
  BLOCKFROST_API_KEY: 'test-blockfrost-key',
  DISCORD_BOT_TOKEN: 'test-discord-bot-token',
  GITHUB_APP_ID: '1234',
  GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\ntest-key\n-----END PRIVATE KEY-----',
  DEEP_ID_ISSUER_URL: 'https://identity.staging.deep-id.ai',
  DEEP_ID_APP_BASE_URL: 'https://app.staging.deep-id.ai',
  DEEP_ID_CLIENT_ID: 'test-deepid-client',
  DEEP_ID_CLIENT_SECRET: 'test-deepid-secret',
};

describe('community worker module', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, ...BASE_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.resetModules();
  });

  it('loads with the full env and exposes the worker bootstrap', async () => {
    const workerModule = await import('../../../src/workers/typescript/community.worker.js');

    expect(typeof workerModule.runCommunityWorker).toBe('function');
  });

  it('fails to load when DISCORD_BOT_TOKEN is missing (caught by env schema)', async () => {
    delete process.env.DISCORD_BOT_TOKEN;

    await expect(import('../../../src/workers/typescript/community.worker.js')).rejects.toThrow(/DISCORD_BOT_TOKEN/);
  });

  it('polls the community queue with a single activity slot — the doc\'s "one snapshot fetch at a time"', async () => {
    const { Worker, NativeConnection } = await import('@temporalio/worker');
    vi.mocked(NativeConnection.connect).mockResolvedValue({} as never);
    const workerRun = vi.fn().mockResolvedValue(undefined);
    vi.mocked(Worker.create).mockResolvedValue({ run: workerRun } as never);

    const { runCommunityWorker } = await import('../../../src/workers/typescript/community.worker.js');
    await runCommunityWorker();

    expect(COMMUNITY_WORKER_MAX_CONCURRENT_ACTIVITIES).toBe(1);
    expect(Worker.create).toHaveBeenCalledWith(
      expect.objectContaining({
        taskQueue: 'community-worker',
        maxConcurrentActivityTaskExecutions: 1,
      }),
    );
    expect(workerRun).toHaveBeenCalled();
  });

  it('refuses to start on a queue the orchestrator cannot dispatch to', async () => {
    process.env.TEMPORAL_COMMUNITY_TASK_QUEUE = 'community-worker-renamed';

    const { Worker, NativeConnection } = await import('@temporalio/worker');
    vi.clearAllMocks();
    const { runCommunityWorker } = await import('../../../src/workers/typescript/community.worker.js');

    await expect(runCommunityWorker()).rejects.toThrow(/community-worker-renamed/);
    expect(NativeConnection.connect).not.toHaveBeenCalled();
    expect(Worker.create).not.toHaveBeenCalled();
  });
});
