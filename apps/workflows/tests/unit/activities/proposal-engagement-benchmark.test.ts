import { describe, expect, it } from 'vitest';
import {
  buildProposalBenchmarkRecord,
  formatBenchmarkOutput,
} from '../../../src/activities/typescript/algorithms/proposal-engagement/benchmark/index.js';
import type { ProposalBenchmarkRecord } from '../../../src/activities/typescript/algorithms/proposal-engagement/types.js';

const mockProposal = {
  id: 10,
  roundId: 31,
  poolId: 1,
  proposerId: 42,
  title: 'Test Proposal',
  content: '',
  link: '',
  featureImage: '',
  requestedAmount: '0',
  awardedAmount: '0',
  isAwarded: true,
  isCompleted: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  teamMembers: '[100, 101]',
  rawJson: '{}',
};

const mockOwners = {
  proposerId: 42,
  teamMembersArray: [100, 101],
  ownersArray: [42, 100, 101],
};

const mockStatus = {
  isAwarded: true,
  isCompleted: true,
  classification: 'funded_concluded' as const,
};

const mockCommunityScore = {
  count: 5,
  avg: 4.2,
  norm: 0.84,
};

const mockTimeWeight = {
  tw: 0.9,
  ageMonths: 2.5,
  bucketIndex: 2,
  isValid: true,
  isWithinWindow: true,
};

const mockScoreResult = {
  proposalReward: 0.756,
  proposalPenalty: 0,
  scored: true,
  skipReason: null,
};

const mockParams = {
  fundedConcludedRewardWeight: 1.0,
  unfundedPenaltyWeight: 0.5,
  engagementWindowMonths: 24,
  monthlyDecayRatePercent: 5,
};

describe('proposal-engagement benchmark', () => {
  describe('buildProposalBenchmarkRecord', () => {
    it('builds a JSON-serializable record from pipeline outputs', () => {
      const record = buildProposalBenchmarkRecord(
        mockProposal,
        mockOwners,
        mockStatus,
        mockCommunityScore,
        mockTimeWeight,
        mockScoreResult,
      );

      expect(record.proposal_id).toBe(10);
      expect(record.round_id).toBe(31);
      expect(record.owners.proposer_id).toBe(42);
      expect(record.owners.team_member_ids).toEqual([100, 101]);
      expect(record.owners.all_owner_ids).toEqual([42, 100, 101]);
      expect(record.classification.classification).toBe('funded_concluded');
      expect(record.community_score.norm).toBe(0.84);
      expect(record.time_weight.tw).toBe(0.9);
      expect(record.score.proposal_reward).toBe(0.756);
      expect(record.score.scored).toBe(true);
      expect(record.score.skip_reason).toBeNull();
    });

    it('captures skip_reason for skipped proposals', () => {
      const skippedScore = {
        proposalReward: 0,
        proposalPenalty: 0,
        scored: false,
        skipReason: 'outside_engagement_window' as const,
      };

      const record = buildProposalBenchmarkRecord(
        mockProposal,
        mockOwners,
        mockStatus,
        mockCommunityScore,
        { ...mockTimeWeight, tw: 0, isWithinWindow: false },
        skippedScore,
      );

      expect(record.score.scored).toBe(false);
      expect(record.score.skip_reason).toBe('outside_engagement_window');
    });

    it('captures unsupported_round skip_reason for early-round proposals', () => {
      const earlyRoundProposal = { ...mockProposal, id: 99, roundId: 2 };
      const skippedScore = {
        proposalReward: 0,
        proposalPenalty: 0,
        scored: false,
        skipReason: 'unsupported_round' as const,
      };

      const record = buildProposalBenchmarkRecord(
        earlyRoundProposal,
        mockOwners,
        mockStatus,
        mockCommunityScore,
        mockTimeWeight,
        skippedScore,
      );

      expect(record.round_id).toBe(2);
      expect(record.score.scored).toBe(false);
      expect(record.score.skip_reason).toBe('unsupported_round');
    });
  });

  describe('formatBenchmarkOutput', () => {
    const baseRecord: ProposalBenchmarkRecord = {
      proposal_id: 0,
      round_id: 36,
      created_at: '',
      owners: { proposer_id: 0, team_member_ids: [], all_owner_ids: [] },
      classification: { is_awarded: false, is_completed: false, classification: 'other' },
      community_score: { count: 0, avg: null, norm: null },
      time_weight: { tw: 0, age_months: 0, bucket_index: 0, is_valid: true, is_within_window: true },
      score: { proposal_reward: 0, proposal_penalty: 0, scored: false, skip_reason: null },
    };

    it('includes metadata with matched and unmatched SubIDs, config, and metrics', () => {
      const records: ProposalBenchmarkRecord[] = [
        {
          ...baseRecord,
          proposal_id: 1,
          owners: { proposer_id: 10, team_member_ids: [], all_owner_ids: [10] },
          score: { proposal_reward: 0.5, proposal_penalty: 0, scored: true, skip_reason: null },
        },
        {
          ...baseRecord,
          proposal_id: 2,
          owners: { proposer_id: 35, team_member_ids: [], all_owner_ids: [35] },
          score: { proposal_reward: 0, proposal_penalty: 0.3, scored: true, skip_reason: null },
        },
      ];

      const result = formatBenchmarkOutput({
        records,
        snapshotId: 'snap-123',
        dids: ['SubID-10', 'SubID-35', 'SubID-100'],
        didScores: new Map([
          ['SubID-10', 0.5],
          ['SubID-35', -0.15],
          ['SubID-100', 0],
        ]),
        didAccumulators: new Map([
          ['SubID-10', { positiveSum: 0.5, negativeSum: 0 }],
          ['SubID-35', { positiveSum: 0, negativeSum: 0.3 }],
          ['SubID-100', { positiveSum: 0, negativeSum: 0 }],
        ]),
        matchedDids: new Set(['SubID-10', 'SubID-35']),
        userIdToDid: new Map([
          [10, 'SubID-10'],
          [35, 'SubID-35'],
          [100, 'SubID-100'],
        ]),
        params: mockParams,
        totalProposalsProcessed: 2,
        totalProposalsScored: 2,
        proposalsSkippedUnsupportedRound: 0,
      });

      expect(result.dids).toHaveLength(3);
      expect(result.metadata.snapshot_id).toBe('snap-123');
      expect(result.metadata.config).toEqual(mockParams);
      expect(result.metadata.dids.provided_ids).toEqual(['SubID-10', 'SubID-35', 'SubID-100']);
      expect(result.metadata.dids.matched_ids).toEqual(['SubID-10', 'SubID-35']);
      expect(result.metadata.dids.unmatched_ids).toEqual(['SubID-100']);
      expect(result.metadata.metrics.total_dids_provided).toBe(3);
      expect(result.metadata.metrics.dids_with_matching_owner).toBe(2);
      expect(result.metadata.metrics.total_proposals_processed).toBe(2);
      expect(result.metadata.metrics.total_proposals_scored).toBe(2);
      expect(result.metadata.metrics.proposals_skipped_unsupported_round).toBe(0);
    });

    it('includes only the provided SubIDs in benchmark output', () => {
      const records: ProposalBenchmarkRecord[] = [
        {
          ...baseRecord,
          proposal_id: 1,
          owners: { proposer_id: 4, team_member_ids: [], all_owner_ids: [4, 35] },
          score: { proposal_reward: 0.8, proposal_penalty: 0, scored: true, skip_reason: null },
        },
      ];

      const result = formatBenchmarkOutput({
        records,
        snapshotId: 'snap-789',
        dids: ['SubID-35'],
        didScores: new Map([['SubID-35', 0.8]]),
        didAccumulators: new Map([['SubID-35', { positiveSum: 0.8, negativeSum: 0 }]]),
        matchedDids: new Set(['SubID-35']),
        userIdToDid: new Map([[35, 'SubID-35']]),
        params: mockParams,
        totalProposalsProcessed: 1,
        totalProposalsScored: 1,
        proposalsSkippedUnsupportedRound: 0,
      });

      expect(result.dids).toHaveLength(1);
      const did = result.dids[0];
      expect(did).toBeDefined();
      if (did) {
        expect(did.did).toBe('SubID-35');
        expect(did.proposal_engagement).toBe(0.8);
      }
    });

    it('populates per-SubID accumulator sums and proposal count', () => {
      const records: ProposalBenchmarkRecord[] = [
        {
          ...baseRecord,
          proposal_id: 1,
          owners: { proposer_id: 10, team_member_ids: [], all_owner_ids: [10] },
          score: { proposal_reward: 0.5, proposal_penalty: 0, scored: true, skip_reason: null },
        },
        {
          ...baseRecord,
          proposal_id: 2,
          owners: { proposer_id: 10, team_member_ids: [], all_owner_ids: [10] },
          score: { proposal_reward: 0, proposal_penalty: 0.2, scored: true, skip_reason: null },
        },
      ];

      const result = formatBenchmarkOutput({
        records,
        snapshotId: 'snap-acc',
        dids: ['SubID-10'],
        didScores: new Map([['SubID-10', 0.4]]),
        didAccumulators: new Map([['SubID-10', { positiveSum: 0.5, negativeSum: 0.2 }]]),
        matchedDids: new Set(['SubID-10']),
        userIdToDid: new Map([[10, 'SubID-10']]),
        params: mockParams,
        totalProposalsProcessed: 2,
        totalProposalsScored: 2,
        proposalsSkippedUnsupportedRound: 0,
      });

      expect(result.dids).toHaveLength(1);
      const did = result.dids[0];
      expect(did).toBeDefined();
      if (did) {
        expect(did.positive_sum).toBe(0.5);
        expect(did.negative_sum).toBe(0.2);
        expect(did.proposal_count).toBe(2);
      }
    });

    it('tracks proposals_skipped_unsupported_round in metrics', () => {
      const records: ProposalBenchmarkRecord[] = [
        {
          ...baseRecord,
          proposal_id: 1,
          round_id: 2,
          owners: { proposer_id: 10, team_member_ids: [], all_owner_ids: [10] },
          score: { proposal_reward: 0, proposal_penalty: 0, scored: false, skip_reason: 'unsupported_round' },
        },
        {
          ...baseRecord,
          proposal_id: 2,
          round_id: 107,
          owners: { proposer_id: 10, team_member_ids: [], all_owner_ids: [10] },
          score: { proposal_reward: 0.5, proposal_penalty: 0, scored: true, skip_reason: null },
        },
      ];

      const result = formatBenchmarkOutput({
        records,
        snapshotId: 'snap-round',
        dids: ['SubID-10'],
        didScores: new Map([['SubID-10', 0.5]]),
        didAccumulators: new Map([['SubID-10', { positiveSum: 0.5, negativeSum: 0 }]]),
        matchedDids: new Set(['SubID-10']),
        userIdToDid: new Map([[10, 'SubID-10']]),
        params: mockParams,
        totalProposalsProcessed: 2,
        totalProposalsScored: 1,
        proposalsSkippedUnsupportedRound: 1,
      });

      expect(result.metadata.metrics.proposals_skipped_unsupported_round).toBe(1);
      expect(result.metadata.metrics.total_proposals_scored).toBe(1);
      expect(result.metadata.metrics.total_proposals_processed).toBe(2);
    });
  });
});
