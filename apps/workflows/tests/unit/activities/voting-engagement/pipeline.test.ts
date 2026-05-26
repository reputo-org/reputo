import { describe, expect, it } from 'vitest';
import { groupVotesByVoter } from '../../../../src/activities/typescript/algorithms/voting-engagement/pipeline/vote-grouping.js';
import type { VoteRecord } from '../../../../src/shared/types/index.js';

const vote = (overrides: Partial<VoteRecord> = {}): VoteRecord => ({
  collection_id: 'voter-1',
  question_id: 'q-1',
  answer: '5',
  ...overrides,
});

describe('vote-grouping', () => {
  it('groups valid votes by voter id', () => {
    const result = groupVotesByVoter([
      vote({ collection_id: 'a', answer: '1' }),
      vote({ collection_id: 'a', answer: 'skip' }),
      vote({ collection_id: 'b', answer: '5' }),
    ]);

    expect(result.votesByVoter.get('a')).toEqual(['1', 'skip']);
    expect(result.votesByVoter.get('b')).toEqual(['5']);
    expect(result.stats.validVotes).toBe(3);
    expect(result.stats.invalidVotes).toBe(0);
  });

  it('classifies empty or unknown answers as invalid', () => {
    const result = groupVotesByVoter([vote({ answer: '' }), vote({ answer: 'maybe' }), vote({ collection_id: '   ' })]);

    expect(result.stats.validVotes).toBe(0);
    expect(result.stats.invalidVotes).toBe(3);
    expect(result.votesByVoter.size).toBe(0);
  });

  it('accepts case-insensitive "skip" votes', () => {
    const result = groupVotesByVoter([vote({ answer: 'SKIP' })]);
    expect(result.stats.validVotes).toBe(1);
    expect(result.votesByVoter.get('voter-1')).toEqual(['skip']);
  });

  it('filters votes outside the allowlist without counting them as invalid', () => {
    const result = groupVotesByVoter(
      [vote({ collection_id: 'allowed' }), vote({ collection_id: 'blocked' })],
      new Set(['allowed']),
    );

    expect(result.votesByVoter.has('allowed')).toBe(true);
    expect(result.votesByVoter.has('blocked')).toBe(false);
    expect(result.stats.invalidVotes).toBe(0);
    expect(result.stats.targetedVoterIds).toBe(1);
  });

  it('reports targetedVoterIds as the number of distinct grouped voters when no allowlist is given', () => {
    const result = groupVotesByVoter([vote({ collection_id: 'a' }), vote({ collection_id: 'b' })]);
    expect(result.stats.targetedVoterIds).toBe(2);
  });
});
