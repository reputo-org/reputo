import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGenerateKey,
  mockStringifyCsvAsync,
  mockBuildVoterBenchmarkRecord,
  mockFormatBenchmarkOutput,
  mockCalculateVotingEngagement,
  mockGroupVotesByVoter,
  mockExtractInputKeys,
  mockLoadVotes,
  mockLoadSubIdInputMap,
  mockGetSubIds,
  mockBuildDeepVotingPortalSubIdsIndex,
  mockHeartbeat,
} = vi.hoisted(() => ({
  mockGenerateKey: vi.fn(),
  mockStringifyCsvAsync: vi.fn(),
  mockBuildVoterBenchmarkRecord: vi.fn(),
  mockFormatBenchmarkOutput: vi.fn(),
  mockCalculateVotingEngagement: vi.fn(),
  mockGroupVotesByVoter: vi.fn(),
  mockExtractInputKeys: vi.fn(),
  mockLoadVotes: vi.fn(),
  mockLoadSubIdInputMap: vi.fn(),
  mockGetSubIds: vi.fn(),
  mockBuildDeepVotingPortalSubIdsIndex: vi.fn(),
  mockHeartbeat: vi.fn(),
}));

vi.mock('@reputo/storage', () => ({
  generateKey: mockGenerateKey,
}));

vi.mock('@temporalio/activity', () => ({
  Context: {
    current: () => ({
      log: {
        info: vi.fn(),
        debug: vi.fn(),
      },
      heartbeat: mockHeartbeat,
    }),
  },
}));

vi.mock('../../../src/shared/utils/index.js', () => ({
  stringifyCsvAsync: mockStringifyCsvAsync,
}));

vi.mock('../../../src/config/index.js', () => ({
  default: {
    storage: {
      bucket: 'test-bucket',
    },
  },
}));

vi.mock('../../../src/activities/typescript/algorithms/voting-engagement/benchmark/index.js', () => ({
  buildVoterBenchmarkRecord: mockBuildVoterBenchmarkRecord,
  formatBenchmarkOutput: mockFormatBenchmarkOutput,
}));

vi.mock('../../../src/activities/typescript/algorithms/voting-engagement/pipeline/index.js', () => ({
  calculateVotingEngagement: mockCalculateVotingEngagement,
  groupVotesByVoter: mockGroupVotesByVoter,
}));

vi.mock('../../../src/activities/typescript/algorithms/voting-engagement/utils/index.js', () => ({
  extractInputKeys: mockExtractInputKeys,
  loadVotes: mockLoadVotes,
}));

vi.mock('../../../src/activities/typescript/algorithms/shared/sub-id-input.js', () => ({
  loadSubIdInputMap: mockLoadSubIdInputMap,
  getSubIds: mockGetSubIds,
  buildDeepVotingPortalSubIdsIndex: mockBuildDeepVotingPortalSubIdsIndex,
}));

import { computeVotingEngagement } from '../../../src/activities/typescript/algorithms/voting-engagement/compute.js';

describe('computeVotingEngagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockExtractInputKeys.mockReturnValue({
      subIdsKey: 'uploads/sub_ids.json',
      votesKey: 'uploads/votes.csv',
    });
    mockLoadSubIdInputMap.mockResolvedValue({
      subIds: {
        'SubID-B': { deepVotingPortalId: 'voter-b', userWallets: [] },
        'SubID-A': { deepVotingPortalId: 'voter-a', userWallets: [] },
      },
    });
    mockGetSubIds.mockReturnValue(['SubID-B', 'SubID-A']);
    mockBuildDeepVotingPortalSubIdsIndex.mockReturnValue(
      new Map([
        ['voter-b', ['SubID-B']],
        ['voter-a', ['SubID-A']],
      ]),
    );
    mockLoadVotes.mockResolvedValue([{ voter_id: 'voter-b' }, { voter_id: 'voter-a' }]);
    mockGroupVotesByVoter.mockReturnValue({
      votesByVoter: new Map([
        ['voter-b', ['1', '5']],
        ['voter-a', ['10']],
      ]),
      stats: {
        totalVotes: 3,
        validVotes: 3,
        invalidVotes: 0,
        targetedVoterIds: 2,
      },
    });
    mockCalculateVotingEngagement.mockImplementation((votes: string[]) => votes.length / 10);
    mockBuildVoterBenchmarkRecord.mockImplementation(
      (subId: string, deepVotingPortalId: string | null, votes: string[], engagement: number) => ({
        sub_id: subId,
        deep_voting_portal_id: deepVotingPortalId,
        total_votes: votes.length,
        voting_engagement: engagement,
      }),
    );
    mockFormatBenchmarkOutput.mockReturnValue({ sub_ids: ['benchmark-output'] });
    mockStringifyCsvAsync.mockResolvedValue('sub_id,voting_engagement\nSubID-A,0.1\nSubID-B,0.2');
    mockGenerateKey.mockReturnValueOnce('outputs/voting.csv').mockReturnValueOnce('outputs/voting-details.json');
  });

  it('sorts SubID results, uploads both outputs, and emits progress heartbeats', async () => {
    const storage = {
      putObject: vi.fn().mockResolvedValue(undefined),
    };

    const result = await computeVotingEngagement(
      {
        id: 'snapshot-1',
        algorithmPresetFrozen: {
          key: 'voting_engagement',
          inputs: [],
        },
      } as never,
      storage as never,
    );

    expect(mockExtractInputKeys).toHaveBeenCalledWith([]);
    expect(mockLoadSubIdInputMap).toHaveBeenCalledWith({
      storage,
      bucket: 'test-bucket',
      key: 'uploads/sub_ids.json',
    });
    expect(mockLoadVotes).toHaveBeenCalledWith(storage, expect.any(String), 'uploads/votes.csv');
    expect(mockGroupVotesByVoter).toHaveBeenCalledWith(
      [{ voter_id: 'voter-b' }, { voter_id: 'voter-a' }],
      new Set(['voter-b', 'voter-a']),
    );
    expect(mockStringifyCsvAsync).toHaveBeenCalledWith(
      [
        { sub_id: 'SubID-A', voting_engagement: 0.1 },
        { sub_id: 'SubID-B', voting_engagement: 0.2 },
      ],
      {
        header: true,
        columns: ['sub_id', 'voting_engagement'],
      },
    );
    expect(storage.putObject).toHaveBeenNthCalledWith(1, {
      bucket: 'test-bucket',
      key: 'outputs/voting.csv',
      body: 'sub_id,voting_engagement\nSubID-A,0.1\nSubID-B,0.2',
      contentType: 'text/csv',
    });
    expect(storage.putObject).toHaveBeenNthCalledWith(2, {
      bucket: 'test-bucket',
      key: 'outputs/voting-details.json',
      body: JSON.stringify({ sub_ids: ['benchmark-output'] }, null, 2),
      contentType: 'application/json',
    });
    expect(mockHeartbeat).toHaveBeenCalledWith({
      phase: 'scoring',
      processed: 0,
      total: 2,
    });
    expect(mockHeartbeat).toHaveBeenCalledWith({ phase: 'upload' });
    expect(result).toEqual({
      outputs: {
        voting_engagement: 'outputs/voting.csv',
        voting_engagement_details: 'outputs/voting-details.json',
      },
    });
  });
});
