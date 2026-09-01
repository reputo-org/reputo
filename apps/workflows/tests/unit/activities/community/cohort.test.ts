import type { CommunityAdapter } from '@reputo/community-api';
import { DeepIdContractError } from '@reputo/deep-id-api';
import { describe, expect, it, vi } from 'vitest';
import { buildCommunityCohort, type CohortUsersClient } from '../../../../src/activities/community/cohort.js';

const identity = (username: string) => ({
  username,
  verifiedAt: '2026-08-01T00:00:00.000Z',
  expiresAt: '2026-11-01T00:00:00.000Z',
  vc: null,
});

function usersClient(pages: Array<Record<string, unknown>>): CohortUsersClient {
  return {
    async *iterateUsers() {
      for (const users of pages) {
        yield { users } as never;
      }
    },
  };
}

function adapterWith(memberIds: Record<string, string | null>) {
  const searchMemberId = vi.fn(async (_communityId: string, username: string) => memberIds[username] ?? null);
  const adapter = { platform: 'discord', searchMemberId } as unknown as CommunityAdapter;
  return { adapter, searchMemberId };
}

const logger = { info: vi.fn(), warn: vi.fn() };

describe('buildCommunityCohort', () => {
  it('keeps only users with the platform scope, matches exact usernames, and sorts by DID', async () => {
    const { adapter, searchMemberId } = adapterWith({ alice: '111' });
    const heartbeat = vi.fn();

    const rows = await buildCommunityCohort({
      platform: 'discord',
      communityId: 'g1',
      adapter,
      deepId: usersClient([
        {
          'did:sub:cccccccccccccccccccccccc': { scopes: ['api', 'discord'], discord: null },
          'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa': { scopes: ['api', 'discord'], discord: identity('alice') },
        },
        {
          'did:sub:bbbbbbbbbbbbbbbbbbbbbbbb': { scopes: ['api', 'discord'], discord: identity('renamed') },
          'did:sub:dddddddddddddddddddddddd': { scopes: ['api', 'wallets'] },
        },
      ]),
      heartbeat,
      logger,
    });

    expect(rows).toEqual([
      { did: 'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa', username: 'alice', accountId: '111', status: 'matched' },
      { did: 'did:sub:bbbbbbbbbbbbbbbbbbbbbbbb', username: 'renamed', accountId: null, status: 'unmatched' },
      { did: 'did:sub:cccccccccccccccccccccccc', username: null, accountId: null, status: 'unmatched' },
    ]);
    // No lookup for the null-username user; the without-scope user never appears.
    expect(searchMemberId).toHaveBeenCalledTimes(2);
    expect(searchMemberId).toHaveBeenCalledWith('g1', 'alice');
    expect(heartbeat).toHaveBeenCalled();
  });

  it('looks a username up once even when two DIDs carry it', async () => {
    const { adapter, searchMemberId } = adapterWith({ alice: '111' });

    const rows = await buildCommunityCohort({
      platform: 'discord',
      communityId: 'g1',
      adapter,
      deepId: usersClient([
        {
          'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa': { scopes: ['discord'], discord: identity('alice') },
          'did:sub:bbbbbbbbbbbbbbbbbbbbbbbb': { scopes: ['discord'], discord: identity('alice') },
        },
      ]),
      heartbeat: vi.fn(),
      logger,
    });

    expect(rows.map((row) => row.accountId)).toEqual(['111', '111']);
    expect(searchMemberId).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed social identity instead of guessing', async () => {
    const { adapter } = adapterWith({});

    await expect(
      buildCommunityCohort({
        platform: 'discord',
        communityId: 'g1',
        adapter,
        deepId: usersClient([
          { 'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa': { scopes: ['discord'], discord: { username: 42 } } },
        ]),
        heartbeat: vi.fn(),
        logger,
      }),
    ).rejects.toThrow(DeepIdContractError);
  });
});
