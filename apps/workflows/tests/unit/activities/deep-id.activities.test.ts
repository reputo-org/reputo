import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockIterateUsers, mockCreateDeepIdClient } = vi.hoisted(() => {
  const iterate = vi.fn();
  return { mockIterateUsers: iterate, mockCreateDeepIdClient: vi.fn(() => ({ iterateUsers: iterate })) };
});

vi.mock('@reputo/deep-id-api', () => ({
  createDeepIdClient: mockCreateDeepIdClient,
}));

vi.mock('@reputo/storage', () => ({
  generateKey: (...parts: string[]) => `${parts[0]}s/${parts.slice(1).join('/')}`,
}));

vi.mock('@temporalio/activity', () => ({
  Context: {
    current: () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, heartbeat: vi.fn() }),
  },
}));

vi.mock('../../../src/config/index.js', () => ({
  default: {
    logger: { level: 'silent' },
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

import { createDeepIdSyncActivity } from '../../../src/activities/orchestrator/deep-id.activities.js';

async function* pages(...items: unknown[]) {
  for (const item of items) {
    yield item;
  }
}

describe('createDeepIdSyncActivity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('assembles a did:sub → wallets map (skipping unsupported chains) and writes it to S3', async () => {
    mockIterateUsers.mockReturnValue(
      pages(
        {
          users: {
            'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa': {
              scopes: ['api', 'wallets'],
              wallets: [
                { type: 'ethereum', address: '0xAbc' },
                { type: 'solana', address: 'sol-skip' },
              ],
            },
          },
        },
        {
          users: {
            'did:sub:bbbbbbbbbbbbbbbbbbbbbbbb': { scopes: ['api'] },
          },
        },
      ),
    );

    const putObject = vi.fn().mockResolvedValue(undefined);
    const activity = createDeepIdSyncActivity({
      storage: { putObject } as never,
      storageConfig: { bucket: 'reputo', maxSizeBytes: 1024 },
    });

    const result = await activity({ snapshotId: 'snap-1' });

    expect(result).toEqual({ didsKey: 'snapshots/snap-1/deep-id/dids.json' });
    expect(putObject).toHaveBeenCalledTimes(1);
    const body = JSON.parse((putObject.mock.calls[0][0] as { body: string }).body);
    expect(body).toEqual({
      'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa': { userWallets: [{ address: '0xAbc', chain: 'ethereum' }] },
      'did:sub:bbbbbbbbbbbbbbbbbbbbbbbb': { userWallets: [] },
    });
  });
});
