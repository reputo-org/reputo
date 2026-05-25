import { describe, expect, it } from 'vitest';
import { getDeepfundingDbKey } from '../../../src/shared/constants/storage-keys.js';
import { stringifyCsvAsync } from '../../../src/shared/utils/csv.js';

describe('storage-keys', () => {
  it('builds the deepfunding DB key under the snapshot prefix', () => {
    expect(getDeepfundingDbKey('snap-123')).toBe('snapshots/snap-123/deepfunding.db');
  });
});

describe('stringifyCsvAsync', () => {
  it('writes records to a CSV string with the configured columns and header', async () => {
    const csv = await stringifyCsvAsync([{ a: 1, b: 2 }], { header: true, columns: ['a', 'b'] });
    expect(csv.trim()).toBe('a,b\n1,2'.trim());
  });

  it('rejects when the records argument is invalid', async () => {
    await expect(stringifyCsvAsync(123 as never, { header: false, columns: ['a'] })).rejects.toBeDefined();
  });
});
