import { describe, expect, it } from 'vitest';
import {
  buildVoterBenchmarkRecord,
  formatBenchmarkOutput,
} from '../../../src/activities/typescript/algorithms/voting-engagement/benchmark/index.js';
import type { VoteGroupingStats } from '../../../src/activities/typescript/algorithms/voting-engagement/pipeline/vote-grouping.js';
import type {
  SubIdBenchmarkRecord,
  ValidVote,
} from '../../../src/activities/typescript/algorithms/voting-engagement/types.js';
import { MAX_VOTING_ENTROPY } from '../../../src/activities/typescript/algorithms/voting-engagement/types.js';

describe('voting-engagement benchmark', () => {
  describe('buildVoterBenchmarkRecord', () => {
    it('builds a record with correct vote distribution', () => {
      const votes: ValidVote[] = ['1', '5', '5', '10', 'skip'];
      const engagement = 0.636514;

      const record = buildVoterBenchmarkRecord('SubID-1', 'voter-abc', votes, engagement);

      expect(record.sub_id).toBe('SubID-1');
      expect(record.deep_voting_portal_id).toBe('voter-abc');
      expect(record.total_votes).toBe(5);
      expect(record.vote_distribution.skip).toBe(1);
      expect(record.vote_distribution['1']).toBe(1);
      expect(record.vote_distribution['5']).toBe(2);
      expect(record.vote_distribution['10']).toBe(1);
      expect(record.vote_distribution['2']).toBe(0);
      expect(record.vote_distribution['3']).toBe(0);
      expect(record.voting_engagement).toBe(0.636514);
    });

    it('computes raw Shannon entropy and rounds it', () => {
      const votes: ValidVote[] = ['skip', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
      const engagement = 1.0;

      const record = buildVoterBenchmarkRecord('SubID-Uniform', 'voter-uniform', votes, engagement);

      expect(record.entropy).toBeCloseTo(MAX_VOTING_ENTROPY, 5);
      expect(record.voting_engagement).toBe(1.0);
    });

    it('returns zero entropy for a single-category voter', () => {
      const votes: ValidVote[] = ['5', '5', '5'];
      const engagement = 0;

      const record = buildVoterBenchmarkRecord('SubID-Mono', 'voter-mono', votes, engagement);

      expect(record.entropy).toBe(0);
      expect(record.total_votes).toBe(3);
      expect(record.vote_distribution['5']).toBe(3);
    });

    it('handles empty votes array', () => {
      const record = buildVoterBenchmarkRecord('SubID-Empty', 'voter-empty', [], 0);

      expect(record.total_votes).toBe(0);
      expect(record.entropy).toBe(0);
      expect(record.voting_engagement).toBe(0);
    });
  });

  describe('formatBenchmarkOutput', () => {
    const baseStats: VoteGroupingStats = {
      totalVotes: 100,
      validVotes: 95,
      invalidVotes: 5,
      targetedVoterIds: 3,
    };

    const baseRecord: SubIdBenchmarkRecord = {
      sub_id: '',
      deep_voting_portal_id: null,
      total_votes: 0,
      vote_distribution: {
        skip: 0,
        '1': 0,
        '2': 0,
        '3': 0,
        '4': 0,
        '5': 0,
        '6': 0,
        '7': 0,
        '8': 0,
        '9': 0,
        '10': 0,
      },
      entropy: 0,
      voting_engagement: 0,
    };

    it('includes metadata with processing stats', () => {
      const records: SubIdBenchmarkRecord[] = [
        {
          ...baseRecord,
          sub_id: 'SubID-1',
          deep_voting_portal_id: 'voter-a',
          total_votes: 50,
          voting_engagement: 0.85,
        },
        {
          ...baseRecord,
          sub_id: 'SubID-2',
          deep_voting_portal_id: 'voter-b',
          total_votes: 30,
          voting_engagement: 0.62,
        },
      ];

      const result = formatBenchmarkOutput({
        records,
        snapshotId: 'snap-123',
        stats: baseStats,
        matchedSubIds: new Set(['SubID-1', 'SubID-2']),
      });

      expect(result.sub_ids).toHaveLength(2);
      expect(result.metadata.snapshot_id).toBe('snap-123');
      expect(result.metadata.metrics.total_votes_in_file).toBe(100);
      expect(result.metadata.metrics.valid_votes).toBe(95);
      expect(result.metadata.metrics.invalid_votes).toBe(5);
      expect(result.metadata.metrics.targeted_voter_ids).toBe(3);
      expect(result.metadata.metrics.sub_ids_with_votes).toBe(2);
      expect(result.metadata.sub_ids.provided_ids).toEqual(['SubID-1', 'SubID-2']);
      expect(result.metadata.sub_ids.matched_ids).toEqual(['SubID-1', 'SubID-2']);
    });

    it('sorts SubIDs by sub_id', () => {
      const records: SubIdBenchmarkRecord[] = [
        { ...baseRecord, sub_id: 'SubID-Z', deep_voting_portal_id: 'voter-z' },
        { ...baseRecord, sub_id: 'SubID-A', deep_voting_portal_id: 'voter-a' },
        { ...baseRecord, sub_id: 'SubID-M', deep_voting_portal_id: 'voter-m' },
      ];

      const result = formatBenchmarkOutput({
        records,
        snapshotId: 'snap-sort',
        stats: baseStats,
        matchedSubIds: new Set(['SubID-A', 'SubID-M', 'SubID-Z']),
      });

      const [first, second, third] = result.sub_ids;
      expect(first?.sub_id).toBe('SubID-A');
      expect(second?.sub_id).toBe('SubID-M');
      expect(third?.sub_id).toBe('SubID-Z');
    });

    it('handles empty records array', () => {
      const emptyStats: VoteGroupingStats = {
        totalVotes: 0,
        validVotes: 0,
        invalidVotes: 0,
        targetedVoterIds: 0,
      };

      const result = formatBenchmarkOutput({
        records: [],
        snapshotId: 'snap-empty',
        stats: emptyStats,
        matchedSubIds: new Set(),
      });

      expect(result.sub_ids).toHaveLength(0);
      expect(result.metadata.metrics.targeted_voter_ids).toBe(0);
    });

    it('does not mutate the original records array', () => {
      const records: SubIdBenchmarkRecord[] = [
        { ...baseRecord, sub_id: 'SubID-B', deep_voting_portal_id: 'voter-b' },
        { ...baseRecord, sub_id: 'SubID-A', deep_voting_portal_id: 'voter-a' },
      ];

      formatBenchmarkOutput({
        records,
        snapshotId: 'snap-immutable',
        stats: baseStats,
        matchedSubIds: new Set(['SubID-A', 'SubID-B']),
      });

      expect(records[0]?.sub_id).toBe('SubID-B');
      expect(records[1]?.sub_id).toBe('SubID-A');
    });
  });
});
