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
  mockLoadWalletCollectionIndex,
  mockLoadDidInputMap,
  mockGetDids,
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
  mockLoadWalletCollectionIndex: vi.fn(),
  mockLoadDidInputMap: vi.fn(),
  mockGetDids: vi.fn(),
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
  loadWalletCollectionIndex: mockLoadWalletCollectionIndex,
}));

vi.mock('../../../src/activities/typescript/algorithms/shared/did-input.js', () => ({
  loadDidInputMap: mockLoadDidInputMap,
  getDids: mockGetDids,
}));

import { computeVotingEngagement } from '../../../src/activities/typescript/algorithms/voting-engagement/compute.js';

describe('computeVotingEngagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockExtractInputKeys.mockReturnValue({
      didsKey: 'uploads/dids.json',
      votesKey: 'uploads/votes.csv',
      walletCollectionsKey: 'uploads/wallet_collections.csv',
    });
    // did:sub → wallets, as assembled from DeepID /v1/users.
    mockLoadDidInputMap.mockResolvedValue({
      dids: {
        'did:sub:bbbbbbbbbbbbbbbbbbbbbbbb': { userWallets: [{ address: '0xb', chain: 'ethereum' }] },
        'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa': { userWallets: [{ address: '0xa', chain: 'ethereum' }] },
      },
    });
    mockGetDids.mockReturnValue(['did:sub:bbbbbbbbbbbbbbbbbbbbbbbb', 'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa']);
    // wallet → collection_id, from wallet_collections.csv.
    mockLoadWalletCollectionIndex.mockResolvedValue(
      new Map([
        ['0xb', ['voter-b']],
        ['0xa', ['voter-a']],
      ]),
    );
    mockLoadVotes.mockResolvedValue([{ collection_id: 'voter-b' }, { collection_id: 'voter-a' }]);
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
      (did: string, votes: string[], engagement: number, collectionIds: string[]) => ({
        did: did,
        collection_ids: collectionIds,
        total_votes: votes.length,
        voting_engagement: engagement,
      }),
    );
    mockFormatBenchmarkOutput.mockReturnValue({ dids: ['benchmark-output'] });
    mockStringifyCsvAsync.mockResolvedValue(
      'did,voting_engagement\ndid:sub:aaaaaaaaaaaaaaaaaaaaaaaa,0.1\ndid:sub:bbbbbbbbbbbbbbbbbbbbbbbb,0.2',
    );
    mockGenerateKey.mockReturnValueOnce('outputs/voting.csv').mockReturnValueOnce('outputs/voting-details.json');
  });

  it('joins wallets to collections, sorts results, and uploads both outputs', async () => {
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
    expect(mockLoadDidInputMap).toHaveBeenCalledWith({
      storage,
      bucket: 'test-bucket',
      key: 'uploads/dids.json',
    });
    expect(mockLoadWalletCollectionIndex).toHaveBeenCalledWith(
      storage,
      'test-bucket',
      'uploads/wallet_collections.csv',
    );
    expect(mockLoadVotes).toHaveBeenCalledWith(storage, expect.any(String), 'uploads/votes.csv');
    expect(mockGroupVotesByVoter).toHaveBeenCalledWith(
      [{ collection_id: 'voter-b' }, { collection_id: 'voter-a' }],
      new Set(['voter-b', 'voter-a']),
    );
    expect(mockStringifyCsvAsync).toHaveBeenCalledWith(
      [
        { did: 'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa', voting_engagement: 0.1 },
        { did: 'did:sub:bbbbbbbbbbbbbbbbbbbbbbbb', voting_engagement: 0.2 },
      ],
      {
        header: true,
        columns: ['did', 'voting_engagement'],
      },
    );
    expect(storage.putObject).toHaveBeenNthCalledWith(1, {
      bucket: 'test-bucket',
      key: 'outputs/voting.csv',
      body: 'did,voting_engagement\ndid:sub:aaaaaaaaaaaaaaaaaaaaaaaa,0.1\ndid:sub:bbbbbbbbbbbbbbbbbbbbbbbb,0.2',
      contentType: 'text/csv',
    });
    expect(storage.putObject).toHaveBeenNthCalledWith(2, {
      bucket: 'test-bucket',
      key: 'outputs/voting-details.json',
      body: JSON.stringify({ dids: ['benchmark-output'] }, null, 2),
      contentType: 'application/json',
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
