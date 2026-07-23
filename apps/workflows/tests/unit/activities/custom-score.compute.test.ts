import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGenerateKey,
  mockGetAlgorithmDefinition,
  mockComputeVotingEngagement,
  mockComputeContributionScore,
  mockComputeProposalEngagement,
  mockComputeTokenValueOverTime,
  mockHeartbeat,
} = vi.hoisted(() => ({
  mockGenerateKey: vi.fn(),
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
    logger: { level: 'silent' },
    app: { nodeEnv: 'production' },
  },
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

function makeStorage() {
  return {
    getObject: vi.fn(),
    putObject: vi.fn().mockResolvedValue(undefined),
  };
}

describe('computeCustomScore', () => {
  beforeEach(() => {
    vi.clearAllMocks();

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

  it('runs each child once and preserves its native CSV key without reading or rebuilding it', async () => {
    const storage = makeStorage();

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

    // The native child artifacts are exposed as-is: no CSV is read back and no
    // per-child wrapper file is written — only the details JSON is uploaded.
    expect(storage.getObject).not.toHaveBeenCalled();
    expect(storage.putObject).toHaveBeenCalledTimes(1);
    expect(storage.putObject).toHaveBeenCalledWith({
      bucket: 'test-bucket',
      key: 'snapshots/snapshot-1/custom_score_details.json',
      body: expect.any(String),
      contentType: 'application/json',
    });

    expect(mockHeartbeat).toHaveBeenCalledWith({ phase: 'children', processed: 0, total: 2 });

    expect(result).toEqual({
      outputs: {
        voting_engagement: 'snapshots/snapshot-1/voting_engagement.csv',
        contribution_score: 'snapshots/snapshot-1/contribution_score.csv',
        custom_score_details: 'snapshots/snapshot-1/custom_score_details.json',
      },
    });
  });

  it('writes configuration-only details without per-user rows or weighted scores', async () => {
    const storage = makeStorage();

    await computeCustomScore(
      buildSnapshot([
        { algorithm_key: 'voting_engagement', algorithm_version: '1.0.0', weight: 1, inputs: [] },
        { algorithm_key: 'contribution_score', algorithm_version: '1.0.0', weight: 3, inputs: [] },
      ]),
      storage as never,
    );

    const detailsPayload = JSON.parse(storage.putObject.mock.calls[0][0].body);
    expect(detailsPayload).toEqual({
      snapshot_id: 'snapshot-1',
      total_child_weight: 4,
      children: [
        { algorithm_key: 'voting_engagement', algorithm_version: '1.0.0', weight: 1 },
        { algorithm_key: 'contribution_score', algorithm_version: '1.0.0', weight: 3 },
      ],
    });
  });

  it('rejects duplicate sub-algorithms before running any child', async () => {
    const storage = makeStorage();

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
    const storage = makeStorage();

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
    const storage = makeStorage();

    await expect(
      computeCustomScore(
        buildSnapshot([{ algorithm_key: 'voting_engagement', algorithm_version: '1.0.0', weight, inputs: [] }]),
        storage as never,
      ),
    ).rejects.toThrow('Invalid sub_algorithms.0.weight');

    expect(mockComputeVotingEngagement).not.toHaveBeenCalled();
  });

  it('fails when a child does not return its native primary CSV output', async () => {
    const storage = makeStorage();
    mockComputeVotingEngagement.mockResolvedValue({ outputs: {} });

    await expect(
      computeCustomScore(
        buildSnapshot([{ algorithm_key: 'voting_engagement', algorithm_version: '1.0.0', weight: 1, inputs: [] }]),
        storage as never,
      ),
    ).rejects.toThrow('Child algorithm "voting_engagement" did not return output "voting_engagement"');

    expect(storage.putObject).not.toHaveBeenCalled();
  });
});
