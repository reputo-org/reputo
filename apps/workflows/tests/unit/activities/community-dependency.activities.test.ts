import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFreeze = vi.fn();

vi.mock('../../../src/activities/community/dataset-engine.js', () => ({
  freezeCommunityDataset: (...args: unknown[]) => mockFreeze(...args),
}));

vi.mock('../../../src/activities/community/cohort.js', () => ({
  buildCommunityCohort: vi.fn(),
}));

vi.mock('@reputo/deep-id-api', () => ({
  createDeepIdClient: vi.fn(() => ({})),
}));

vi.mock('../../../src/config/index.js', () => ({
  default: {
    community: {
      requestTimeoutMs: 1000,
      retryMaxAttempts: 1,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 2,
      discordBotToken: 'bot-token',
      githubAppId: '1',
      githubAppPrivateKey: 'pem',
      mattermostAllowedHosts: [],
      mattermostMaxResponseBytes: 1024,
      credentials: { currentSecret: 'x'.repeat(32) },
    },
    deepId: {
      identityBaseUrl: 'https://identity.test',
      appBaseUrl: 'https://app.test',
      clientId: 'id',
      clientSecret: 'secret',
      scopes: [],
      requestTimeoutMs: 1000,
      concurrency: 1,
      usersPageSize: 100,
      retryMaxAttempts: 1,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 2,
    },
    logger: { level: 'silent' },
  },
}));

vi.mock('@temporalio/activity', () => {
  class ApplicationFailure extends Error {
    type?: string;
    nonRetryable?: boolean;
    static create({ message, type, nonRetryable }: { message: string; type?: string; nonRetryable?: boolean }) {
      const failure = new ApplicationFailure(message);
      failure.type = type;
      failure.nonRetryable = nonRetryable;
      return failure;
    }
  }
  return {
    ApplicationFailure,
    Context: {
      current: () => ({
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        heartbeat: vi.fn(),
        info: { heartbeatDetails: undefined },
      }),
    },
  };
});

import { CommunityAuthError, CommunityNetworkError, CommunityRateLimitError } from '@reputo/community-api';
import type { Storage } from '@reputo/storage';
import { createCommunityDependencyResolverActivities } from '../../../src/activities/community/dependency.activities.js';

const ctx = {
  storage: {} as Storage,
  storageConfig: { bucket: 'test-bucket', maxSizeBytes: 1024 },
} as never;

const input = {
  dependencyKey: 'discord-activity' as const,
  snapshotId: 'snapshot-1',
  communityFetch: {
    connectionId: 'conn-1',
    communityId: 'guild-1',
    resourceIds: ['111'],
    windowStart: '2026-06-01T00:00:00.000Z',
    windowEnd: '2026-08-01T00:00:00.000Z',
  },
};

async function failedResolve() {
  const activities = createCommunityDependencyResolverActivities(ctx);
  return activities.resolveDependency(input).then(
    () => {
      throw new Error('expected the dependency to fail');
    },
    (error: Error & { type?: string; nonRetryable?: boolean }) => error,
  );
}

describe('community dependency safe failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails fast on categories whose remedy is an admin reconnect', async () => {
    mockFreeze.mockRejectedValue(new CommunityAuthError('401 with a response-body snippet', 401));

    const error = await failedResolve();

    expect(error.message).toBe('Community discord fetch failed: auth_failed');
    expect(error.type).toBe('CommunityFetchError');
    expect(error.nonRetryable).toBe(true);
  });

  it('keeps transient categories retryable', async () => {
    for (const transient of [new CommunityRateLimitError('slow down', 1000), new CommunityNetworkError('timeout')]) {
      mockFreeze.mockRejectedValue(transient);

      const error = await failedResolve();

      expect(error.message).toBe(`Community discord fetch failed: ${transient.category}`);
      expect(error.nonRetryable).toBe(false);
    }
  });

  it('passes non-platform errors through unchanged', async () => {
    const original = new Error('disk full');
    mockFreeze.mockRejectedValue(original);

    const error = await failedResolve();

    expect(error).toBe(original);
  });
});
