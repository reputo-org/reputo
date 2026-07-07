import type { Storage } from '@reputo/storage';
import { describe, expect, it, vi } from 'vitest';
import {
  buildWalletDidsIndex,
  type DidInputMap,
  extractDidsKey,
  getDids,
  getWalletsForChain,
  getWalletsForSelectedResources,
  loadDidInputMap,
} from '../../../../src/activities/typescript/algorithms/shared/did-input.js';

const map: DidInputMap = {
  dids: {
    'sub-a': {
      userWallets: [
        { address: '0xabc', chain: 'ethereum' },
        { address: 'addr1qx...', chain: 'cardano' },
      ],
    },
    'sub-b': {
      userWallets: [{ address: '0xdef', chain: 'ethereum' }],
    },
  },
};

describe('extractDidsKey', () => {
  it('returns the value of the dids input', () => {
    expect(
      extractDidsKey([
        { key: 'votes_csv', value: 'votes.csv' },
        { key: 'dids', value: 'dids.json' },
      ] as never),
    ).toBe('dids.json');
  });

  it('throws when the dids input is missing or not a string', () => {
    expect(() => extractDidsKey([] as never)).toThrow('Missing required "dids" input');
    expect(() => extractDidsKey([{ key: 'dids', value: 123 }] as never)).toThrow();
  });
});

describe('loadDidInputMap', () => {
  it('parses JSON, dedupes/lowercases ethereum wallet addresses, and drops unknown chains', async () => {
    const storage = {
      getObject: vi.fn().mockResolvedValue(
        Buffer.from(
          JSON.stringify({
            'did:sub:1': {
              userWallets: [
                { address: '0xABC', chain: 'ethereum' },
                { address: '0xABC', chain: 'ethereum' },
                { address: 'addr1', chain: 'cardano' },
                { address: '', chain: 'ethereum' },
                { address: '0xdef', chain: 'unknown' },
              ],
            },
            '': { ignored: true },
            'did:sub:2': 'not-an-object',
          }),
        ),
      ),
    } as unknown as Storage;

    const result = await loadDidInputMap({ storage, bucket: 'b', key: 'k' });

    expect(Object.keys(result.dids)).toEqual(['did:sub:1']);
    expect(result.dids['did:sub:1']).toEqual({
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

    const result = await loadDidInputMap({ storage, bucket: 'b', key: 'k' });

    expect(result.dids).toEqual({});
  });
});

describe('getDids', () => {
  it('returns the sub ids sorted alphabetically', () => {
    expect(getDids(map)).toEqual(['sub-a', 'sub-b']);
  });
});

describe('buildWalletDidsIndex', () => {
  it('indexes each wallet address to the sub ids it appears under, sorted', () => {
    const index = buildWalletDidsIndex(map);
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
