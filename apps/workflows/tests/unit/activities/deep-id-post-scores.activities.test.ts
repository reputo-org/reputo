import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPostScores, mockCreateDeepIdClient } = vi.hoisted(() => {
  const post = vi.fn();
  return { mockPostScores: post, mockCreateDeepIdClient: vi.fn(() => ({ postScores: post })) };
});

// Keep the real isValidDid / chunk, mock only the client factory.
vi.mock('@reputo/deep-id-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@reputo/deep-id-api')>();
  return { ...actual, createDeepIdClient: mockCreateDeepIdClient };
});

vi.mock('@temporalio/activity', () => ({
  Context: {
    current: () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, heartbeat: vi.fn() }),
  },
}));

vi.mock('../../../src/config/index.js', () => ({
  default: {
    logger: { level: 'silent' },
    storage: { bucket: 'reputo' },
    deepId: {
      identityBaseUrl: 'https://identity.test',
      appBaseUrl: 'https://app.test',
      clientId: 'cid',
      clientSecret: 'secret',
      scopes: 'api wallets post_scores',
      requestTimeoutMs: 1000,
      concurrency: 2,
      usersPageSize: 500,
      retryMaxAttempts: 3,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 2,
    },
  },
}));

import { createDeepIdPostScoresActivity } from '../../../src/activities/orchestrator/deep-id-post-scores.activities.js';

const DID_A = 'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa';

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'snap-1',
    completedAt: '2026-06-12T10:00:00.000Z',
    algorithmPresetFrozen: { key: 'voting_engagement', version: '1.0.0', inputs: [] },
    outputs: { voting_engagement: 'snapshots/snap-1/voting_engagement.csv' },
    ...overrides,
  } as never;
}

describe('createDeepIdPostScoresActivity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('posts only DID-keyed rows verbatim with type=algorithm key and completedAt timestamp', async () => {
    const csv = [
      'did,voting_engagement',
      `${DID_A},0.8`,
      'not-a-did,0.5',
      'did:sub:cccccccccccccccccccccccc,not-a-number',
    ].join('\n');

    const getObject = vi.fn().mockResolvedValue(Buffer.from(csv, 'utf8'));
    mockPostScores.mockResolvedValue({ status: { ok: 1, failed: 0 }, results: { [DID_A]: { message: 'OK' } } });

    const activity = createDeepIdPostScoresActivity({
      storage: { getObject } as never,
      storageConfig: { bucket: 'reputo', maxSizeBytes: 1024 },
    });

    const result = await activity({ snapshot: makeSnapshot() });

    expect(result).toEqual({ posted: 1, ok: 1, failed: 0, skipped: 2 });
    expect(mockPostScores).toHaveBeenCalledWith({
      [DID_A]: { score: 0.8, type: 'voting_engagement', timestamp: '2026-06-12T10:00:00.000Z' },
    });
  });

  it('skips when the algorithm key is not a DeepID score type', async () => {
    const getObject = vi.fn();
    const activity = createDeepIdPostScoresActivity({
      storage: { getObject } as never,
      storageConfig: { bucket: 'reputo', maxSizeBytes: 1024 },
    });

    const result = await activity({
      snapshot: makeSnapshot({ algorithmPresetFrozen: { key: 'deepfunding_sync', version: '1.0.0', inputs: [] } }),
    });

    expect(result).toEqual({ posted: 0, ok: 0, failed: 0, skipped: 0 });
    expect(getObject).not.toHaveBeenCalled();
    expect(mockPostScores).not.toHaveBeenCalled();
  });
});
