import { describe, expect, it } from 'vitest';
import {
  buildVoterBenchmarkRecord,
  formatBenchmarkOutput,
} from '../../../src/activities/typescript/algorithms/voting-engagement/benchmark/index.js';
import type { VoteGroupingStats } from '../../../src/activities/typescript/algorithms/voting-engagement/pipeline/vote-grouping.js';
import type {
  DidBenchmarkRecord,
  ValidVote,
} from '../../../src/activities/typescript/algorithms/voting-engagement/types.js';
import { MAX_VOTING_ENTROPY } from '../../../src/activities/typescript/algorithms/voting-engagement/types.js';

describe('voting-engagement benchmark', () => {
  describe('buildVoterBenchmarkRecord', () => {
    it('builds a record with correct vote distribution', () => {
      const votes: ValidVote[] = ['1', '5', '5', '10', 'skip'];
      const engagement = 0.636514;

      const record = buildVoterBenchmarkRecord('did:sub:1', votes, engagement);

      expect(record.did).toBe('did:sub:1');
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

      const record = buildVoterBenchmarkRecord('did:sub:Uniform', votes, engagement);

      expect(record.entropy).toBeCloseTo(MAX_VOTING_ENTROPY, 5);
      expect(record.voting_engagement).toBe(1.0);
    });

    it('returns zero entropy for a single-category voter', () => {
      const votes: ValidVote[] = ['5', '5', '5'];
      const engagement = 0;

      const record = buildVoterBenchmarkRecord('did:sub:Mono', votes, engagement);

      expect(record.entropy).toBe(0);
      expect(record.total_votes).toBe(3);
      expect(record.vote_distribution['5']).toBe(3);
    });

    it('handles empty votes array', () => {
      const record = buildVoterBenchmarkRecord('did:sub:Empty', [], 0);

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

    const baseRecord: DidBenchmarkRecord = {
      did: '',
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
      const records: DidBenchmarkRecord[] = [
        {
          ...baseRecord,
          did: 'did:sub:1',
          total_votes: 50,
          voting_engagement: 0.85,
        },
        {
          ...baseRecord,
          did: 'did:sub:2',
          total_votes: 30,
          voting_engagement: 0.62,
        },
      ];

      const result = formatBenchmarkOutput({
        records,
        snapshotId: 'snap-123',
        stats: baseStats,
        matchedDids: new Set(['did:sub:1', 'did:sub:2']),
      });

      expect(result.dids).toHaveLength(2);
      expect(result.metadata.snapshot_id).toBe('snap-123');
      expect(result.metadata.metrics.total_votes_in_file).toBe(100);
      expect(result.metadata.metrics.valid_votes).toBe(95);
      expect(result.metadata.metrics.invalid_votes).toBe(5);
      expect(result.metadata.metrics.targeted_voter_ids).toBe(3);
      expect(result.metadata.metrics.dids_with_votes).toBe(2);
      expect(result.metadata.dids.provided_ids).toEqual(['did:sub:1', 'did:sub:2']);
      expect(result.metadata.dids.matched_ids).toEqual(['did:sub:1', 'did:sub:2']);
    });

    it('sorts DIDs by did', () => {
      const records: DidBenchmarkRecord[] = [
        { ...baseRecord, did: 'did:sub:Z' },
        { ...baseRecord, did: 'did:sub:A' },
        { ...baseRecord, did: 'did:sub:M' },
      ];

      const result = formatBenchmarkOutput({
        records,
        snapshotId: 'snap-sort',
        stats: baseStats,
        matchedDids: new Set(['did:sub:A', 'did:sub:M', 'did:sub:Z']),
      });

      const [first, second, third] = result.dids;
      expect(first?.did).toBe('did:sub:A');
      expect(second?.did).toBe('did:sub:M');
      expect(third?.did).toBe('did:sub:Z');
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
        matchedDids: new Set(),
      });

      expect(result.dids).toHaveLength(0);
      expect(result.metadata.metrics.targeted_voter_ids).toBe(0);
    });

    it('does not mutate the original records array', () => {
      const records: DidBenchmarkRecord[] = [
        { ...baseRecord, did: 'did:sub:B' },
        { ...baseRecord, did: 'did:sub:A' },
      ];

      formatBenchmarkOutput({
        records,
        snapshotId: 'snap-immutable',
        stats: baseStats,
        matchedDids: new Set(['did:sub:A', 'did:sub:B']),
      });

      expect(records[0]?.did).toBe('did:sub:B');
      expect(records[1]?.did).toBe('did:sub:A');
    });
  });
});
