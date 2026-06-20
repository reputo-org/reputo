import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGenerateKey,
  mockStringifyCsvAsync,
  mockExtractDidsKey,
  mockLoadDidInputMap,
  mockGetDids,
  mockGetAlgorithmDefinition,
  mockComputeVotingEngagement,
  mockComputeContributionScore,
  mockComputeProposalEngagement,
  mockComputeTokenValueOverTime,
  mockHeartbeat,
} = vi.hoisted(() => ({
  mockGenerateKey: vi.fn(),
  mockStringifyCsvAsync: vi.fn(),
  mockExtractDidsKey: vi.fn(),
  mockLoadDidInputMap: vi.fn(),
  mockGetDids: vi.fn(),
  mockGetAlgorithmDefinition: vi.fn(),
  mockComputeVotingEngagement: vi.fn(),
  mockComputeContributionScore: vi.fn(),
  mockComputeProposalEngagement: vi.fn(),
  mockComputeTokenValueOverTime: vi.fn(),
  mockHeartbeat: vi.fn(),
}));

vi.mock('@reputo/storage', () => ({
  generateKey: mockGenerateKey,
}));

vi.mock('@reputo/reputation-algorithms', () => ({
  getAlgorithmDefinition: mockGetAlgorithmDefinition,
}));

vi.mock('@temporalio/activity', () => ({
  Context: {
    current: () => ({
      log: {
        info: vi.fn(),
      },
      heartbeat: mockHeartbeat,
    }),
  },
}));

vi.mock('../../../src/config/index.js', () => ({
  default: {
    storage: {
      bucket: 'test-bucket',
    },
  },
}));

vi.mock('../../../src/shared/utils/index.js', () => ({
  stringifyCsvAsync: mockStringifyCsvAsync,
}));

vi.mock('../../../src/activities/typescript/algorithms/shared/did-input.js', () => ({
  extractDidsKey: mockExtractDidsKey,
  loadDidInputMap: mockLoadDidInputMap,
  getDids: mockGetDids,
}));

vi.mock('../../../src/activities/typescript/algorithms/voting-engagement/compute.js', () => ({
  computeVotingEngagement: mockComputeVotingEngagement,
}));

vi.mock('../../../src/activities/typescript/algorithms/contribution-score/compute.js', () => ({
  computeContributionScore: mockComputeContributionScore,
}));

vi.mock('../../../src/activities/typescript/algorithms/proposal-engagement/compute.js', () => ({
  computeProposalEngagement: mockComputeProposalEngagement,
}));

vi.mock('../../../src/activities/typescript/algorithms/token-value-over-time/compute.js', () => ({
  computeTokenValueOverTime: mockComputeTokenValueOverTime,
}));

import { computeCustomScore } from '../../../src/activities/typescript/algorithms/custom-score/compute.js';

describe('computeCustomScore', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockExtractDidsKey.mockReturnValue('uploads/dids.json');
    mockLoadDidInputMap.mockResolvedValue({
      dids: {
        'SubID-1': {},
        'SubID-2': {},
        'SubID-3': {},
      },
    });
    mockGetDids.mockReturnValue(['SubID-1', 'SubID-2', 'SubID-3']);
    mockStringifyCsvAsync.mockResolvedValue(
      ['did,composite_score', 'SubID-1,0.388889', 'SubID-2,0.333333', 'SubID-3,0.666667'].join('\n'),
    );
    mockGenerateKey.mockReturnValueOnce('outputs/composite_score.csv').mockReturnValueOnce('outputs/details.json');
    mockGetAlgorithmDefinition.mockReturnValue(
      JSON.stringify({
        key: 'voting_engagement',
        version: '1.0.0',
        kind: 'standalone',
        runtime: 'typescript',
        outputs: [
          { key: 'voting_engagement_details', type: 'json' },
          {
            key: 'voting_engagement',
            type: 'csv',
            csv: {
              columns: [{ key: 'did' }, { key: 'voting_engagement' }],
            },
          },
        ],
      }),
    );
    mockComputeVotingEngagement.mockImplementation(async (snapshot: { id: string }) => ({
      outputs: {
        voting_engagement: `snapshots/${snapshot.id}/voting_engagement.csv`,
        voting_engagement_details: `snapshots/${snapshot.id}/voting_engagement_details.json`,
      },
    }));
  });

  it('runs child algorithms with synthetic snapshots, zero-fills missing scores, and writes composite artifacts', async () => {
    const putObject = vi.fn().mockResolvedValue(undefined);
    const storage = {
      getObject: vi.fn().mockImplementation(async ({ key }: { key: string }) => {
        if (key.includes('__custom_score_child_1_')) {
          return Buffer.from(['did,voting_engagement', 'SubID-1,10', 'SubID-2,20'].join('\n'));
        }

        if (key.includes('__custom_score_child_2_')) {
          return Buffer.from(['did,voting_engagement', 'SubID-1,1', 'SubID-3,3'].join('\n'));
        }

        throw new Error(`Unexpected key: ${key}`);
      }),
      putObject,
    };

    const result = await computeCustomScore(
      {
        id: 'snapshot-1',
        algorithmPresetFrozen: {
          key: 'custom_score',
          version: '1.0.0',
          inputs: [
            { key: 'dids', value: 'uploads/dids.json' },
            {
              key: 'sub_algorithms',
              value: [
                {
                  algorithm_key: 'voting_engagement',
                  algorithm_version: '1.0.0',
                  weight: 1,
                  inputs: [{ key: 'votes', value: 'uploads/votes-a.csv' }],
                },
                {
                  algorithm_key: 'voting_engagement',
                  algorithm_version: '1.0.0',
                  weight: 2,
                  inputs: [{ key: 'votes', value: 'uploads/votes-b.csv' }],
                },
              ],
            },
            { key: 'normalization_method', value: 'min_max' },
            { key: 'missing_score_strategy', value: 'zero' },
          ],
        },
      } as never,
      storage as never,
    );

    expect(mockLoadDidInputMap).toHaveBeenCalledWith({
      storage,
      bucket: 'test-bucket',
      key: 'uploads/dids.json',
    });
    expect(mockComputeVotingEngagement).toHaveBeenCalledTimes(2);
    expect(mockComputeVotingEngagement).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: 'snapshot-1__custom_score_child_1_voting_engagement',
        algorithmPresetFrozen: {
          key: 'voting_engagement',
          version: '1.0.0',
          inputs: [
            { key: 'votes', value: 'uploads/votes-a.csv' },
            { key: 'dids', value: 'uploads/dids.json' },
          ],
        },
      }),
      storage,
    );
    expect(mockComputeVotingEngagement).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: 'snapshot-1__custom_score_child_2_voting_engagement',
        algorithmPresetFrozen: {
          key: 'voting_engagement',
          version: '1.0.0',
          inputs: [
            { key: 'votes', value: 'uploads/votes-b.csv' },
            { key: 'dids', value: 'uploads/dids.json' },
          ],
        },
      }),
      storage,
    );
    expect(storage.getObject).toHaveBeenNthCalledWith(1, {
      bucket: 'test-bucket',
      key: 'snapshots/snapshot-1__custom_score_child_1_voting_engagement/voting_engagement.csv',
    });
    expect(storage.getObject).toHaveBeenNthCalledWith(2, {
      bucket: 'test-bucket',
      key: 'snapshots/snapshot-1__custom_score_child_2_voting_engagement/voting_engagement.csv',
    });
    expect(mockStringifyCsvAsync).toHaveBeenCalledWith(
      [
        { did: 'SubID-1', composite_score: 0.388889 },
        { did: 'SubID-2', composite_score: 0.333333 },
        { did: 'SubID-3', composite_score: 0.666667 },
      ],
      {
        header: true,
        columns: ['did', 'composite_score'],
      },
    );
    expect(storage.putObject).toHaveBeenNthCalledWith(1, {
      bucket: 'test-bucket',
      key: 'outputs/composite_score.csv',
      body: ['did,composite_score', 'SubID-1,0.388889', 'SubID-2,0.333333', 'SubID-3,0.666667'].join('\n'),
      contentType: 'text/csv',
    });

    const detailsPayload = JSON.parse(putObject.mock.calls[1][0].body);
    expect(detailsPayload).toEqual({
      snapshot_id: 'snapshot-1',
      normalization_method: 'min_max',
      missing_score_strategy: 'zero',
      total_child_weight: 3,
      dids: [
        {
          did: 'SubID-1',
          final_composite_score: 0.388889,
          child_scores: [
            {
              algorithm_key: 'voting_engagement',
              algorithm_version: '1.0.0',
              raw_score: 10,
              normalized_score: 0.5,
              child_weight: 1,
              weighted_contribution: 0.166667,
            },
            {
              algorithm_key: 'voting_engagement',
              algorithm_version: '1.0.0',
              raw_score: 1,
              normalized_score: 0.333333,
              child_weight: 2,
              weighted_contribution: 0.222222,
            },
          ],
        },
        {
          did: 'SubID-2',
          final_composite_score: 0.333333,
          child_scores: [
            {
              algorithm_key: 'voting_engagement',
              algorithm_version: '1.0.0',
              raw_score: 20,
              normalized_score: 1,
              child_weight: 1,
              weighted_contribution: 0.333333,
            },
            {
              algorithm_key: 'voting_engagement',
              algorithm_version: '1.0.0',
              raw_score: 0,
              normalized_score: 0,
              child_weight: 2,
              weighted_contribution: 0,
            },
          ],
        },
        {
          did: 'SubID-3',
          final_composite_score: 0.666667,
          child_scores: [
            {
              algorithm_key: 'voting_engagement',
              algorithm_version: '1.0.0',
              raw_score: 0,
              normalized_score: 0,
              child_weight: 1,
              weighted_contribution: 0,
            },
            {
              algorithm_key: 'voting_engagement',
              algorithm_version: '1.0.0',
              raw_score: 3,
              normalized_score: 1,
              child_weight: 2,
              weighted_contribution: 0.666667,
            },
          ],
        },
      ],
    });
    expect(mockHeartbeat).toHaveBeenCalledWith({
      phase: 'children',
      processed: 0,
      total: 2,
    });
    expect(mockHeartbeat).toHaveBeenCalledWith({
      phase: 'combine',
      processed: 0,
      total: 3,
    });
    expect(mockHeartbeat).toHaveBeenCalledWith({ phase: 'upload' });
    expect(result).toEqual({
      outputs: {
        composite_score: 'outputs/composite_score.csv',
        composite_score_details: 'outputs/details.json',
      },
    });
  });

  it('preserves raw scores when normalization is disabled and applies weighted combination deterministically', async () => {
    mockGetDids.mockReturnValue(['SubID-1', 'SubID-2']);
    mockStringifyCsvAsync.mockResolvedValue(['did,composite_score', 'SubID-1,1.75', 'SubID-2,3.75'].join('\n'));

    const putObject = vi.fn().mockResolvedValue(undefined);
    const storage = {
      getObject: vi.fn().mockImplementation(async ({ key }: { key: string }) => {
        if (key.includes('__custom_score_child_1_')) {
          return Buffer.from(['did,voting_engagement', 'SubID-1,1', 'SubID-2,3'].join('\n'));
        }

        if (key.includes('__custom_score_child_2_')) {
          return Buffer.from(['did,voting_engagement', 'SubID-1,2', 'SubID-2,4'].join('\n'));
        }

        throw new Error(`Unexpected key: ${key}`);
      }),
      putObject,
    };

    await computeCustomScore(
      {
        id: 'snapshot-1',
        algorithmPresetFrozen: {
          key: 'custom_score',
          version: '1.0.0',
          inputs: [
            { key: 'dids', value: 'uploads/dids.json' },
            {
              key: 'sub_algorithms',
              value: [
                {
                  algorithm_key: 'voting_engagement',
                  algorithm_version: '1.0.0',
                  weight: 1,
                  inputs: [{ key: 'votes', value: 'uploads/votes-a.csv' }],
                },
                {
                  algorithm_key: 'voting_engagement',
                  algorithm_version: '1.0.0',
                  weight: 3,
                  inputs: [{ key: 'votes', value: 'uploads/votes-b.csv' }],
                },
              ],
            },
            { key: 'normalization_method', value: 'none' },
            { key: 'missing_score_strategy', value: 'zero' },
          ],
        },
      } as never,
      storage as never,
    );

    expect(mockStringifyCsvAsync).toHaveBeenCalledWith(
      [
        { did: 'SubID-1', composite_score: 1.75 },
        { did: 'SubID-2', composite_score: 3.75 },
      ],
      {
        header: true,
        columns: ['did', 'composite_score'],
      },
    );

    const detailsPayload = JSON.parse(putObject.mock.calls[1][0].body);
    expect(detailsPayload).toEqual({
      snapshot_id: 'snapshot-1',
      normalization_method: 'none',
      missing_score_strategy: 'zero',
      total_child_weight: 4,
      dids: [
        {
          did: 'SubID-1',
          final_composite_score: 1.75,
          child_scores: [
            {
              algorithm_key: 'voting_engagement',
              algorithm_version: '1.0.0',
              raw_score: 1,
              normalized_score: 1,
              child_weight: 1,
              weighted_contribution: 0.25,
            },
            {
              algorithm_key: 'voting_engagement',
              algorithm_version: '1.0.0',
              raw_score: 2,
              normalized_score: 2,
              child_weight: 3,
              weighted_contribution: 1.5,
            },
          ],
        },
        {
          did: 'SubID-2',
          final_composite_score: 3.75,
          child_scores: [
            {
              algorithm_key: 'voting_engagement',
              algorithm_version: '1.0.0',
              raw_score: 3,
              normalized_score: 3,
              child_weight: 1,
              weighted_contribution: 0.75,
            },
            {
              algorithm_key: 'voting_engagement',
              algorithm_version: '1.0.0',
              raw_score: 4,
              normalized_score: 4,
              child_weight: 3,
              weighted_contribution: 3,
            },
          ],
        },
      ],
    });
  });

  it('normalizes zero-variance z-scores to zero deterministically', async () => {
    mockGetDids.mockReturnValue(['SubID-1', 'SubID-2']);
    mockStringifyCsvAsync.mockResolvedValue(['did,composite_score', 'SubID-1,0', 'SubID-2,0'].join('\n'));

    const putObject = vi.fn().mockResolvedValue(undefined);
    const storage = {
      getObject: vi.fn().mockResolvedValue(Buffer.from(['did,voting_engagement', 'SubID-1,5', 'SubID-2,5'].join('\n'))),
      putObject,
    };

    await computeCustomScore(
      {
        id: 'snapshot-2',
        algorithmPresetFrozen: {
          key: 'custom_score',
          version: '1.0.0',
          inputs: [
            { key: 'dids', value: 'uploads/dids.json' },
            {
              key: 'sub_algorithms',
              value: [
                {
                  algorithm_key: 'voting_engagement',
                  algorithm_version: '1.0.0',
                  weight: 1,
                  inputs: [],
                },
              ],
            },
            { key: 'normalization_method', value: 'z_score' },
            { key: 'missing_score_strategy', value: 'zero' },
          ],
        },
      } as never,
      storage as never,
    );

    expect(mockStringifyCsvAsync).toHaveBeenCalledWith(
      [
        { did: 'SubID-1', composite_score: 0 },
        { did: 'SubID-2', composite_score: 0 },
      ],
      {
        header: true,
        columns: ['did', 'composite_score'],
      },
    );

    const detailsPayload = JSON.parse(putObject.mock.calls[1][0].body);
    expect(detailsPayload.dids).toEqual([
      {
        did: 'SubID-1',
        final_composite_score: 0,
        child_scores: [
          {
            algorithm_key: 'voting_engagement',
            algorithm_version: '1.0.0',
            raw_score: 5,
            normalized_score: 0,
            child_weight: 1,
            weighted_contribution: 0,
          },
        ],
      },
      {
        did: 'SubID-2',
        final_composite_score: 0,
        child_scores: [
          {
            algorithm_key: 'voting_engagement',
            algorithm_version: '1.0.0',
            raw_score: 5,
            normalized_score: 0,
            child_weight: 1,
            weighted_contribution: 0,
          },
        ],
      },
    ]);
  });

  it('fails fast for unsupported missing score strategies', async () => {
    const storage = {
      putObject: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      computeCustomScore(
        {
          id: 'snapshot-3',
          algorithmPresetFrozen: {
            key: 'custom_score',
            version: '1.0.0',
            inputs: [
              { key: 'dids', value: 'uploads/dids.json' },
              {
                key: 'sub_algorithms',
                value: [
                  {
                    algorithm_key: 'voting_engagement',
                    algorithm_version: '1.0.0',
                    weight: 1,
                    inputs: [],
                  },
                ],
              },
              { key: 'normalization_method', value: 'none' },
              { key: 'missing_score_strategy', value: 'exclude' },
            ],
          },
        } as never,
        storage as never,
      ),
    ).rejects.toThrow('Unsupported missing_score_strategy: exclude');

    expect(mockComputeVotingEngagement).not.toHaveBeenCalled();
  });
});
