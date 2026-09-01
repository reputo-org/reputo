import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockComputeContributionScore,
  mockComputeCustomScore,
  mockComputeDiscordEngagement,
  mockComputeGithubEngagement,
  mockComputeProposalEngagement,
  mockComputeVotingEngagement,
  mockComputeTokenValueOverTime,
} = vi.hoisted(() => ({
  mockComputeContributionScore: vi.fn(),
  mockComputeCustomScore: vi.fn(),
  mockComputeDiscordEngagement: vi.fn(),
  mockComputeGithubEngagement: vi.fn(),
  mockComputeProposalEngagement: vi.fn(),
  mockComputeVotingEngagement: vi.fn(),
  mockComputeTokenValueOverTime: vi.fn(),
}));

vi.mock('../../../src/activities/typescript/algorithms/contribution-score/compute.js', () => ({
  computeContributionScore: mockComputeContributionScore,
}));

vi.mock('../../../src/activities/typescript/algorithms/custom-score/compute.js', () => ({
  computeCustomScore: mockComputeCustomScore,
}));

vi.mock('../../../src/activities/typescript/algorithms/proposal-engagement/compute.js', () => ({
  computeProposalEngagement: mockComputeProposalEngagement,
}));

vi.mock('../../../src/activities/typescript/algorithms/voting-engagement/compute.js', () => ({
  computeVotingEngagement: mockComputeVotingEngagement,
}));

vi.mock('../../../src/activities/typescript/algorithms/token-value-over-time/compute.js', () => ({
  computeTokenValueOverTime: mockComputeTokenValueOverTime,
}));

vi.mock('../../../src/activities/typescript/algorithms/discord-engagement/compute.js', () => ({
  computeDiscordEngagement: mockComputeDiscordEngagement,
}));

vi.mock('../../../src/activities/typescript/algorithms/github-engagement/compute.js', () => ({
  computeGithubEngagement: mockComputeGithubEngagement,
}));

import { dispatchAlgorithm } from '../../../src/activities/typescript/dispatchAlgorithm.activity.js';

describe('dispatchAlgorithm mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockComputeCustomScore.mockResolvedValue({
      outputs: {
        voting_engagement: 'outputs/voting-engagement-weighted-score.csv',
        custom_score_details: 'outputs/custom-score-details.json',
      },
    });
    mockComputeTokenValueOverTime.mockResolvedValue({
      outputs: {
        token_value_over_time: 'outputs/token.csv',
        token_value_over_time_details: 'outputs/token-details.json',
      },
    });
  });

  it('routes token_value_over_time snapshots to computeTokenValueOverTime', async () => {
    const run = dispatchAlgorithm({} as never);

    const snapshot = {
      id: 'snapshot-1',
      algorithmPresetFrozen: {
        key: 'token_value_over_time',
        version: '1.0.0',
        inputs: [],
      },
    };

    const result = await run(snapshot as never);

    expect(mockComputeTokenValueOverTime).toHaveBeenCalledOnce();
    expect(result).toEqual({
      outputs: {
        token_value_over_time: 'outputs/token.csv',
        token_value_over_time_details: 'outputs/token-details.json',
      },
    });
  });

  it('routes custom_score snapshots to computeCustomScore', async () => {
    const run = dispatchAlgorithm({} as never);

    const snapshot = {
      id: 'snapshot-2',
      algorithmPresetFrozen: {
        key: 'custom_score',
        version: '1.0.0',
        inputs: [],
      },
    };

    const result = await run(snapshot as never);

    expect(mockComputeCustomScore).toHaveBeenCalledOnce();
    expect(result).toEqual({
      outputs: {
        voting_engagement: 'outputs/voting-engagement-weighted-score.csv',
        custom_score_details: 'outputs/custom-score-details.json',
      },
    });
  });
});
