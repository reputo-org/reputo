import { describe, expect, it } from 'vitest';
import { collectUploadKeys } from '../../../../src/shared/utils/upload-keys.util';

describe('collectUploadKeys', () => {
  it('collects top-level uploads/ values and ignores everything else', () => {
    const keys = collectUploadKeys([
      { key: 'votes', value: 'uploads/uuid-1/votes.csv' },
      { key: 'output', value: 'snapshots/s1/result.csv' },
      { key: 'window', value: 24 },
      { key: 'label', value: 'uploads-not-a-key' },
      { key: 'empty' },
      { key: 'null', value: null },
    ]);

    expect(keys).toEqual(['uploads/uuid-1/votes.csv']);
  });

  it('collects uploads/ values nested inside sub-algorithm entries', () => {
    const keys = collectUploadKeys([
      {
        key: 'sub_algorithms',
        value: [
          {
            algorithm_key: 'voting_engagement',
            algorithm_version: '1.0.0',
            weight: 1,
            inputs: [
              { key: 'votes', value: 'uploads/uuid-2/votes.csv' },
              { key: 'window', value: 48 },
            ],
          },
          {
            algorithm_key: 'token_value_over_time',
            algorithm_version: '1.0.0',
            weight: 2,
            inputs: [{ key: 'wallets', value: 'uploads/uuid-3/wallets.json' }],
          },
        ],
      },
    ]);

    expect(keys).toEqual(['uploads/uuid-2/votes.csv', 'uploads/uuid-3/wallets.json']);
  });

  it('deduplicates keys referenced more than once', () => {
    const keys = collectUploadKeys([
      { key: 'votes', value: 'uploads/uuid-1/votes.csv' },
      {
        key: 'sub_algorithms',
        value: [
          {
            algorithm_key: 'voting_engagement',
            algorithm_version: '1.0.0',
            weight: 1,
            inputs: [{ key: 'votes', value: 'uploads/uuid-1/votes.csv' }],
          },
        ],
      },
    ]);

    expect(keys).toEqual(['uploads/uuid-1/votes.csv']);
  });

  it('ignores array values that are not sub-algorithm entries', () => {
    const keys = collectUploadKeys([
      {
        key: 'targets',
        value: ['uploads/uuid-4/loose.csv', { inputs: [{ key: 'x', value: 'uploads/uuid-5/x.csv' }] }],
      },
    ]);

    expect(keys).toEqual([]);
  });
});
