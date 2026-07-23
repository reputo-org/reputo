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

function standaloneDefinition(key: string) {
  return JSON.stringify({
    key,
    version: '1.0.0',
    kind: 'standalone',
    runtime: 'typescript',
    outputs: [
      { key: `${key}_details`, type: 'json' },
      {
        key,
        type: 'csv',
        csv: {
          columns: [{ key: 'did' }, { key }],
        },
      },
    ],
  });
}

function buildSnapshot(subAlgorithms: unknown) {
  return {
    id: 'snapshot-1',
    algorithmPresetFrozen: {
      key: 'custom_score',
      version: '1.0.0',
      inputs: [
        { key: 'dids', value: 'uploads/dids.json' },
        { key: 'sub_algorithms', value: subAlgorithms },
      ],
    },
  } as never;
}

describe('computeCustomScore', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockExtractDidsKey.mockReturnValue('uploads/dids.json');
    mockLoadDidInputMap.mockResolvedValue({
      dids: {
        'did:sub:1': {},
        'did:sub:2': {},
        'did:sub:3': {},
      },
    });
    mockGetDids.mockReturnValue(['did:sub:1', 'did:sub:2', 'did:sub:3']);
    mockStringifyCsvAsync.mockResolvedValue('csv-body');
    mockGenerateKey.mockImplementation(
      (_prefix: string, id: string, filename: string) => `snapshots/${id}/${filename}`,
    );
    mockGetAlgorithmDefinition.mockImplementation(({ key }: { key: string }) => standaloneDefinition(key));
    mockComputeVotingEngagement.mockImplementation(async (snapshot: { id: string }) => ({
      outputs: {
        voting_engagement: `snapshots/${snapshot.id}/voting_engagement.csv`,
        voting_engagement_details: `snapshots/${snapshot.id}/voting_engagement_details.json`,
      },
    }));
    mockComputeContributionScore.mockImplementation(async (snapshot: { id: string }) => ({
      outputs: {
        contribution_score: `snapshots/${snapshot.id}/contribution_score.csv`,
        contribution_score_details: `snapshots/${snapshot.id}/contribution_score_details.json`,
      },
    }));
  });

  it('runs each child once, zero-fills missing users, and writes one weighted CSV per child plus the details JSON', async () => {
    const putObject = vi.fn().mockResolvedValue(undefined);
    const storage = {
      getObject: vi.fn().mockImplementation(async ({ key }: { key: string }) => {
        if (key === 'snapshots/snapshot-1/voting_engagement.csv') {
          return Buffer.from(['did,voting_engagement', 'did:sub:1,10', 'did:sub:2,20'].join('\n'));
        }

        if (key === 'snapshots/snapshot-1/contribution_score.csv') {
          return Buffer.from(['did,contribution_score', 'did:sub:1,1', 'did:sub:3,3'].join('\n'));
        }

        throw new Error(`Unexpected key: ${key}`);
      }),
      putObject,
    };

    const result = await computeCustomScore(
      buildSnapshot([
        {
          algorithm_key: 'voting_engagement',
          algorithm_version: '1.0.0',
          weight: 1,
          inputs: [{ key: 'votes', value: 'uploads/votes.csv' }],
        },
        {
          algorithm_key: 'contribution_score',
          algorithm_version: '1.0.0',
          weight: 3,
          inputs: [],
        },
      ]),
      storage as never,
    );

    expect(mockLoadDidInputMap).toHaveBeenCalledWith({
      storage,
      bucket: 'test-bucket',
      key: 'uploads/dids.json',
    });
    // Children keep the parent snapshot id so id-derived dependency artifacts
    // (e.g. the run's single deepfunding.db) resolve for every child.
    expect(mockComputeVotingEngagement).toHaveBeenCalledTimes(1);
    expect(mockComputeVotingEngagement).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'snapshot-1',
        algorithmPresetFrozen: {
          key: 'voting_engagement',
          version: '1.0.0',
          inputs: [
            { key: 'votes', value: 'uploads/votes.csv' },
            { key: 'dids', value: 'uploads/dids.json' },
          ],
        },
      }),
      storage,
    );
    expect(mockComputeContributionScore).toHaveBeenCalledTimes(1);
    expect(mockComputeContributionScore).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'snapshot-1',
        algorithmPresetFrozen: {
          key: 'contribution_score',
          version: '1.0.0',
          inputs: [{ key: 'dids', value: 'uploads/dids.json' }],
        },
      }),
      storage,
    );

    // Weighted score = raw × weight ÷ Σweights (Σ = 4).
    expect(mockStringifyCsvAsync).toHaveBeenNthCalledWith(
      1,
      [
        { did: 'did:sub:1', weighted_score: 2.5 },
        { did: 'did:sub:2', weighted_score: 5 },
        { did: 'did:sub:3', weighted_score: 0 },
      ],
      { header: true, columns: ['did', 'weighted_score'] },
    );
    expect(mockStringifyCsvAsync).toHaveBeenNthCalledWith(
      2,
      [
        { did: 'did:sub:1', weighted_score: 0.75 },
        { did: 'did:sub:2', weighted_score: 0 },
        { did: 'did:sub:3', weighted_score: 2.25 },
      ],
      { header: true, columns: ['did', 'weighted_score'] },
    );

    expect(putObject).toHaveBeenNthCalledWith(1, {
      bucket: 'test-bucket',
      key: 'snapshots/snapshot-1/voting_engagement_weighted_score.csv',
      body: 'csv-body',
      contentType: 'text/csv',
    });
    expect(putObject).toHaveBeenNthCalledWith(2, {
      bucket: 'test-bucket',
      key: 'snapshots/snapshot-1/contribution_score_weighted_score.csv',
      body: 'csv-body',
      contentType: 'text/csv',
    });

    const detailsPayload = JSON.parse(putObject.mock.calls[2][0].body);
    expect(detailsPayload).toEqual({
      snapshot_id: 'snapshot-1',
      total_child_weight: 4,
      children: [
        { algorithm_key: 'voting_engagement', algorithm_version: '1.0.0', weight: 1, weight_share: 0.25 },
        { algorithm_key: 'contribution_score', algorithm_version: '1.0.0', weight: 3, weight_share: 0.75 },
      ],
      dids: [
        {
          did: 'did:sub:1',
          child_scores: [
            { algorithm_key: 'voting_engagement', raw_score: 10, weighted_score: 2.5 },
            { algorithm_key: 'contribution_score', raw_score: 1, weighted_score: 0.75 },
          ],
        },
        {
          did: 'did:sub:2',
          child_scores: [
            { algorithm_key: 'voting_engagement', raw_score: 20, weighted_score: 5 },
            { algorithm_key: 'contribution_score', raw_score: 0, weighted_score: 0 },
          ],
        },
        {
          did: 'did:sub:3',
          child_scores: [
            { algorithm_key: 'voting_engagement', raw_score: 0, weighted_score: 0 },
            { algorithm_key: 'contribution_score', raw_score: 3, weighted_score: 2.25 },
          ],
        },
      ],
    });

    expect(mockHeartbeat).toHaveBeenCalledWith({ phase: 'children', processed: 0, total: 2 });
    expect(mockHeartbeat).toHaveBeenCalledWith({ phase: 'upload', processed: 0, total: 2 });
    expect(mockHeartbeat).toHaveBeenCalledWith({ phase: 'details', processed: 0, total: 3 });

    expect(result).toEqual({
      outputs: {
        voting_engagement: 'snapshots/snapshot-1/voting_engagement_weighted_score.csv',
        contribution_score: 'snapshots/snapshot-1/contribution_score_weighted_score.csv',
        custom_score_details: 'snapshots/snapshot-1/custom_score_details.json',
      },
    });
  });

  it('keeps already-normalized child scores unchanged when a single child carries the full weight', async () => {
    // Children already emit 0–100, so custom_score must NOT re-run min–max — an
    // all-equal child vector keeps its value rather than collapsing to 0.
    mockGetDids.mockReturnValue(['did:sub:1', 'did:sub:2']);

    const putObject = vi.fn().mockResolvedValue(undefined);
    const storage = {
      getObject: vi
        .fn()
        .mockResolvedValue(Buffer.from(['did,voting_engagement', 'did:sub:1,5', 'did:sub:2,5'].join('\n'))),
      putObject,
    };

    await computeCustomScore(
      buildSnapshot([
        {
          algorithm_key: 'voting_engagement',
          algorithm_version: '1.0.0',
          weight: 2.5,
          inputs: [],
        },
      ]),
      storage as never,
    );

    expect(mockStringifyCsvAsync).toHaveBeenCalledWith(
      [
        { did: 'did:sub:1', weighted_score: 5 },
        { did: 'did:sub:2', weighted_score: 5 },
      ],
      { header: true, columns: ['did', 'weighted_score'] },
    );

    const detailsPayload = JSON.parse(putObject.mock.calls[1][0].body);
    expect(detailsPayload.children).toEqual([
      { algorithm_key: 'voting_engagement', algorithm_version: '1.0.0', weight: 2.5, weight_share: 1 },
    ]);
  });

  it('rejects duplicate sub-algorithms before running any child', async () => {
    const storage = {
      getObject: vi.fn(),
      putObject: vi.fn(),
    };

    await expect(
      computeCustomScore(
        buildSnapshot([
          { algorithm_key: 'voting_engagement', algorithm_version: '1.0.0', weight: 1, inputs: [] },
          { algorithm_key: 'voting_engagement', algorithm_version: '1.0.0', weight: 3, inputs: [] },
        ]),
        storage as never,
      ),
    ).rejects.toThrow('Duplicate sub-algorithm "voting_engagement": each sub-algorithm can be added only once');

    expect(mockComputeVotingEngagement).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('rejects a configuration whose total weight overflows to Infinity', async () => {
    const storage = {
      getObject: vi.fn(),
      putObject: vi.fn(),
    };

    await expect(
      computeCustomScore(
        buildSnapshot([
          { algorithm_key: 'voting_engagement', algorithm_version: '1.0.0', weight: Number.MAX_VALUE, inputs: [] },
          { algorithm_key: 'contribution_score', algorithm_version: '1.0.0', weight: Number.MAX_VALUE, inputs: [] },
        ]),
        storage as never,
      ),
    ).rejects.toThrow('Invalid sub_algorithms weights: the total weight must be finite');

    expect(mockComputeVotingEngagement).not.toHaveBeenCalled();
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['non-finite', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
    ['missing', undefined],
    ['malformed', '2'],
  ])('rejects a %s child weight', async (_case, weight) => {
    const storage = {
      getObject: vi.fn(),
      putObject: vi.fn(),
    };

    await expect(
      computeCustomScore(
        buildSnapshot([{ algorithm_key: 'voting_engagement', algorithm_version: '1.0.0', weight, inputs: [] }]),
        storage as never,
      ),
    ).rejects.toThrow('Invalid sub_algorithms.0.weight');

    expect(mockComputeVotingEngagement).not.toHaveBeenCalled();
  });
});
