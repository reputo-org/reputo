import { describe, expect, it, vi } from 'vitest';
import { loadWalletCollectionIndex } from '../../../src/activities/typescript/algorithms/voting-engagement/utils/voting-collections-loader.js';

function storageReturning(csv: string) {
  return { getObject: vi.fn().mockResolvedValue(Buffer.from(csv, 'utf8')) } as never;
}

describe('loadWalletCollectionIndex', () => {
  it('indexes wallet (lower-cased) → collection_id[] and groups multiple collections per wallet', async () => {
    const csv = [
      'collection_id,address',
      'col-1,0xABCdef0000000000000000000000000000000001',
      'col-2,0xabcdef0000000000000000000000000000000001',
      'col-3,addr1xyz',
    ].join('\n');

    const index = await loadWalletCollectionIndex(storageReturning(csv), 'bucket', 'key');

    expect(index.get('0xabcdef0000000000000000000000000000000001')).toEqual(['col-1', 'col-2']);
    expect(index.get('addr1xyz')).toEqual(['col-3']);
  });

  it('skips rows missing a collection_id or address and de-duplicates collections', async () => {
    const csv = ['collection_id,address', ',0xwallet', 'col-1,', 'col-2,0xWALLET', 'col-2,0xwallet'].join('\n');

    const index = await loadWalletCollectionIndex(storageReturning(csv), 'bucket', 'key');

    expect(index.size).toBe(1);
    expect(index.get('0xwallet')).toEqual(['col-2']);
  });
});
