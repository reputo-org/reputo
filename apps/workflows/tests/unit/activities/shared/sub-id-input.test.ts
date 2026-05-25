import type { Storage } from '@reputo/storage';
import { describe, expect, it, vi } from 'vitest';
import {
  buildDeepProposalPortalSubIdsIndex,
  buildDeepVotingPortalSubIdsIndex,
  buildWalletSubIdsIndex,
  extractSubIdsKey,
  getSubIds,
  getWalletsForChain,
  getWalletsForSelectedResources,
  loadSubIdInputMap,
  type SubIdInputMap,
} from '../../../../src/activities/typescript/algorithms/shared/sub-id-input.js';

const map: SubIdInputMap = {
  subIds: {
    'sub-a': {
      deepVotingPortalId: 'voting-a',
      deepProposalPortalId: 'proposal-a',
      userWallets: [
        { address: '0xabc', chain: 'ethereum' },
        { address: 'addr1qx...', chain: 'cardano' },
      ],
    },
    'sub-b': {
      deepVotingPortalId: 'voting-b',
      userWallets: [{ address: '0xdef', chain: 'ethereum' }],
    },
  },
};

describe('extractSubIdsKey', () => {
  it('returns the value of the sub_ids input', () => {
    expect(
      extractSubIdsKey([
        { key: 'votes_csv', value: 'votes.csv' },
        { key: 'sub_ids', value: 'sub-ids.json' },
      ] as never),
    ).toBe('sub-ids.json');
  });

  it('throws when the sub_ids input is missing or not a string', () => {
    expect(() => extractSubIdsKey([] as never)).toThrow('Missing required "sub_ids" input');
    expect(() => extractSubIdsKey([{ key: 'sub_ids', value: 123 }] as never)).toThrow();
  });
});

describe('loadSubIdInputMap', () => {
  it('parses JSON, normalizes string/number ids, and lowercases ethereum wallet addresses', async () => {
    const storage = {
      getObject: vi.fn().mockResolvedValue(
        Buffer.from(
          JSON.stringify({
            'SubID-1': {
              deepVotingPortalId: 'user-1',
              deepProposalPortalId: 99,
              userWallets: [
                { address: '0xABC', chain: 'ethereum' },
                { address: '0xABC', chain: 'ethereum' },
                { address: 'addr1', chain: 'cardano' },
                { address: '', chain: 'ethereum' },
                { address: '0xdef', chain: 'unknown' },
              ],
            },
            '': { ignored: true },
            'SubID-2': 'not-an-object',
          }),
        ),
      ),
    } as unknown as Storage;

    const result = await loadSubIdInputMap({ storage, bucket: 'b', key: 'k' });

    expect(Object.keys(result.subIds)).toEqual(['SubID-1']);
    expect(result.subIds['SubID-1']).toEqual({
      deepVotingPortalId: 'user-1',
      deepProposalPortalId: '99',
      userWallets: [
        { address: '0xabc', chain: 'ethereum' },
        { address: 'addr1', chain: 'cardano' },
      ],
    });
  });

  it('returns an empty map when the JSON root is not an object', async () => {
    const storage = {
      getObject: vi.fn().mockResolvedValue(Buffer.from('[1, 2, 3]')),
    } as unknown as Storage;

    const result = await loadSubIdInputMap({ storage, bucket: 'b', key: 'k' });

    expect(result.subIds).toEqual({});
  });
});

describe('getSubIds', () => {
  it('returns the sub ids sorted alphabetically', () => {
    expect(getSubIds(map)).toEqual(['sub-a', 'sub-b']);
  });
});

describe('buildDeepVotingPortalSubIdsIndex', () => {
  it('indexes each voting portal id to the sub ids that map to it', () => {
    const index = buildDeepVotingPortalSubIdsIndex(map);
    expect(index.get('voting-a')).toEqual(['sub-a']);
    expect(index.get('voting-b')).toEqual(['sub-b']);
  });

  it('omits sub ids without a voting portal id', () => {
    const map: SubIdInputMap = {
      subIds: { 'sub-a': { userWallets: [] } },
    };
    expect(buildDeepVotingPortalSubIdsIndex(map).size).toBe(0);
  });
});

describe('buildDeepProposalPortalSubIdsIndex', () => {
  it('indexes only sub ids that have a proposal portal id', () => {
    const index = buildDeepProposalPortalSubIdsIndex(map);
    expect(index.size).toBe(1);
    expect(index.get('proposal-a')).toEqual(['sub-a']);
  });
});

describe('buildWalletSubIdsIndex', () => {
  it('indexes each wallet address to the sub ids it appears under, sorted', () => {
    const index = buildWalletSubIdsIndex(map);
    expect(index.get('0xabc')).toEqual(['sub-a']);
    expect(index.get('0xdef')).toEqual(['sub-b']);
    expect(index.get('addr1qx...')).toEqual(['sub-a']);
  });
});

describe('getWalletsForChain', () => {
  it('returns the unique wallet addresses for a single chain', () => {
    expect(getWalletsForChain(map, 'ethereum').sort()).toEqual(['0xabc', '0xdef']);
    expect(getWalletsForChain(map, 'cardano')).toEqual(['addr1qx...']);
  });
});

describe('getWalletsForSelectedResources', () => {
  it('returns wallets for chains present in the selected resources', () => {
    const ethereumOnly = getWalletsForSelectedResources(map, [{ chain: 'ethereum' }]);
    expect(ethereumOnly.sort()).toEqual(['0xabc', '0xdef']);

    const both = getWalletsForSelectedResources(map, [{ chain: 'ethereum' }, { chain: 'cardano' }]);
    expect(both.length).toBe(3);
  });
});
