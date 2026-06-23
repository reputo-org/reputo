import type { CommentRecord, CommentVoteRecord } from '@reputo/deepfunding-portal-api';
import { describe, expect, it } from 'vitest';
import {
  calculateBaseScore,
  computeCommentScore,
} from '../../../../src/activities/typescript/algorithms/contribution-score/pipeline/comment-scoring.js';
import { computeOwnerBonus } from '../../../../src/activities/typescript/algorithms/contribution-score/pipeline/owner-bonus.js';
import { detectSelfInteraction } from '../../../../src/activities/typescript/algorithms/contribution-score/pipeline/self-interaction.js';
import {
  calculateTimeWeight,
  computeTimeWeightFromString,
} from '../../../../src/activities/typescript/algorithms/contribution-score/pipeline/time-weight.js';
import {
  aggregateVotesByComment,
  getVoteStats,
} from '../../../../src/activities/typescript/algorithms/contribution-score/pipeline/vote-aggregation.js';
import type { ContributionScoreParams } from '../../../../src/activities/typescript/algorithms/contribution-score/types.js';

const PARAMS: ContributionScoreParams = {
  engagementWindowMonths: 12,
  monthlyDecayRatePercent: 10,
  commentBaseScore: 1,
  commentUpvoteWeight: 2,
  commentDownvoteWeight: 1,
  projectOwnerUpvoteBonusMultiplier: 1.5,
  selfInteractionPenaltyFactor: 0.5,
};

describe('owner-bonus', () => {
  it('returns no bonus when proposal has no registered owners', () => {
    const votes = { upvotes: 0, downvotes: 0, upvoterIds: new Set([1, 2]) };
    const projectOwnerMap = new Map<number, Set<number>>();

    const result = computeOwnerBonus(99, votes, projectOwnerMap, 2);

    expect(result).toEqual({ ownerUpvoted: false, ownerBonus: 1 });
  });

  it('returns bonus when an owner is among the upvoters', () => {
    const votes = { upvotes: 2, downvotes: 0, upvoterIds: new Set([1, 5]) };
    const projectOwnerMap = new Map<number, Set<number>>([[42, new Set([5, 7])]]);

    const result = computeOwnerBonus(42, votes, projectOwnerMap, 2);

    expect(result).toEqual({ ownerUpvoted: true, ownerBonus: 2 });
  });

  it('returns no bonus when owners exist but did not upvote', () => {
    const votes = { upvotes: 1, downvotes: 0, upvoterIds: new Set([1]) };
    const projectOwnerMap = new Map<number, Set<number>>([[42, new Set([5, 7])]]);

    const result = computeOwnerBonus(42, votes, projectOwnerMap, 2);

    expect(result).toEqual({ ownerUpvoted: false, ownerBonus: 1 });
  });
});

describe('time-weight', () => {
  it('returns full weight for fresh comments (bucket 0)', () => {
    const now = new Date('2026-05-01T00:00:00Z');
    const createdAt = new Date('2026-04-29T00:00:00Z');

    const result = calculateTimeWeight(createdAt, now, { engagementWindowMonths: 12, monthlyDecayRatePercent: 10 });

    expect(result.tw).toBe(1);
    expect(result.bucketIndex).toBe(0);
    expect(result.isWithinWindow).toBe(true);
    expect(result.isValid).toBe(true);
  });

  it('decays linearly across buckets', () => {
    const now = new Date('2026-05-01T00:00:00Z');
    const createdAt = new Date('2026-02-01T00:00:00Z');

    const result = calculateTimeWeight(createdAt, now, { engagementWindowMonths: 12, monthlyDecayRatePercent: 10 });

    expect(result.bucketIndex).toBeGreaterThanOrEqual(2);
    expect(result.tw).toBeLessThan(1);
    expect(result.isWithinWindow).toBe(true);
  });

  it('returns zero weight beyond the engagement window', () => {
    const now = new Date('2027-05-01T00:00:00Z');
    const createdAt = new Date('2026-01-01T00:00:00Z');

    const result = calculateTimeWeight(createdAt, now, { engagementWindowMonths: 6, monthlyDecayRatePercent: 10 });

    expect(result.tw).toBe(0);
    expect(result.isWithinWindow).toBe(false);
  });

  it('clamps to zero when the decay rate fully decays before the window ends', () => {
    const now = new Date('2026-12-01T00:00:00Z');
    const createdAt = new Date('2026-01-01T00:00:00Z');

    const result = calculateTimeWeight(createdAt, now, { engagementWindowMonths: 24, monthlyDecayRatePercent: 50 });

    expect(result.tw).toBe(0);
    expect(result.isWithinWindow).toBe(false);
  });

  it('parses ISO timestamps via the string helper', () => {
    const result = computeTimeWeightFromString('2026-04-29T00:00:00Z', new Date('2026-05-01T00:00:00Z'), {
      engagementWindowMonths: 12,
      monthlyDecayRatePercent: 10,
    });

    expect(result.tw).toBe(1);
  });
});

describe('vote-aggregation', () => {
  it('aggregates upvotes and downvotes by comment id', () => {
    const votes: CommentVoteRecord[] = [
      { commentId: 1, voterId: 11, voteType: 'upvote' } as CommentVoteRecord,
      { commentId: 1, voterId: 12, voteType: 'upvote' } as CommentVoteRecord,
      { commentId: 1, voterId: 13, voteType: 'downvote' } as CommentVoteRecord,
      { commentId: 2, voterId: 11, voteType: 'upvote' } as CommentVoteRecord,
    ];

    const result = aggregateVotesByComment(votes);

    expect(result.get(1)).toEqual({ upvotes: 2, downvotes: 1, upvoterIds: new Set([11, 12]) });
    expect(result.get(2)).toEqual({ upvotes: 1, downvotes: 0, upvoterIds: new Set([11]) });
  });

  it('ignores votes with unknown types', () => {
    const votes = [{ commentId: 1, voterId: 11, voteType: 'abstain' } as unknown as CommentVoteRecord];

    const result = aggregateVotesByComment(votes);

    expect(result.get(1)).toEqual({ upvotes: 0, downvotes: 0, upvoterIds: new Set() });
  });

  it('returns empty stats for unseen comment ids', () => {
    const voteMap = new Map();

    const result = getVoteStats(99, voteMap);

    expect(result).toEqual({ upvotes: 0, downvotes: 0, upvoterIds: new Set() });
  });
});

describe('self-interaction', () => {
  const baseComment: CommentRecord = {
    id: 7,
    userId: 100,
    proposalId: 42,
    parentId: 0,
    isReply: false,
    createdAt: '2026-05-01T00:00:00Z',
  } as unknown as CommentRecord;

  it('detects related-project authors', () => {
    const result = detectSelfInteraction(baseComment, 0.5, {
      relationMap: new Map([['100-42', true]]),
      commentAuthorMap: new Map(),
    });

    expect(result.isRelatedProject).toBe(true);
    expect(result.discountConditions).toBe(1);
    expect(result.discountMultiplier).toBe(0.5);
  });

  it('detects self-reply authors and stacks the penalty', () => {
    const comment = { ...baseComment, isReply: true, parentId: 3 };

    const result = detectSelfInteraction(comment, 0.5, {
      relationMap: new Map([['100-42', true]]),
      commentAuthorMap: new Map([[3, 100]]),
    });

    expect(result.isRelatedProject).toBe(true);
    expect(result.isSameAuthorReply).toBe(true);
    expect(result.discountConditions).toBe(2);
    expect(result.discountMultiplier).toBe(0.25);
  });

  it('does not penalize unrelated authors', () => {
    const result = detectSelfInteraction(baseComment, 0.5, {
      relationMap: new Map(),
      commentAuthorMap: new Map(),
    });

    expect(result.isRelatedProject).toBe(false);
    expect(result.isSameAuthorReply).toBe(false);
    expect(result.discountConditions).toBe(0);
    expect(result.discountMultiplier).toBe(1);
  });

  it('ignores parent lookups when parentId is 0 or the comment is not a reply', () => {
    const comment = { ...baseComment, parentId: 0, isReply: true };

    const result = detectSelfInteraction(comment, 0.5, {
      relationMap: new Map(),
      commentAuthorMap: new Map([[0, 100]]),
    });

    expect(result.isSameAuthorReply).toBe(false);
  });
});

describe('comment-scoring', () => {
  it('returns zero score when the comment is outside the engagement window', () => {
    const result = computeCommentScore({
      votes: { upvotes: 5, downvotes: 0, upvoterIds: new Set() },
      params: PARAMS,
      timeWeight: { tw: 0, ageMonths: 13, bucketIndex: 13, isValid: true, isWithinWindow: false },
      selfInteraction: {
        isRelatedProject: false,
        isSameAuthorReply: false,
        discountConditions: 0,
        discountMultiplier: 1,
      },
      ownerBonus: { ownerUpvoted: false, ownerBonus: 1 },
    });

    expect(result).toEqual({ score: 0, scored: false });
  });

  it('multiplies base score by all weighting factors', () => {
    const base = calculateBaseScore({ upvotes: 4, downvotes: 1, upvoterIds: new Set() }, PARAMS);
    expect(base).toBe(PARAMS.commentBaseScore + 4 * PARAMS.commentUpvoteWeight - 1 * PARAMS.commentDownvoteWeight);

    const result = computeCommentScore({
      votes: { upvotes: 4, downvotes: 1, upvoterIds: new Set() },
      params: PARAMS,
      timeWeight: { tw: 0.8, ageMonths: 1, bucketIndex: 1, isValid: true, isWithinWindow: true },
      selfInteraction: {
        isRelatedProject: false,
        isSameAuthorReply: false,
        discountConditions: 0,
        discountMultiplier: 0.5,
      },
      ownerBonus: { ownerUpvoted: true, ownerBonus: 2 },
    });

    expect(result.scored).toBe(true);
    expect(result.score).toBeCloseTo(2 * 0.8 * 0.5 * base);
  });

  it('skips scoring when the time-weight is marked invalid', () => {
    const result = computeCommentScore({
      votes: { upvotes: 5, downvotes: 0, upvoterIds: new Set() },
      params: PARAMS,
      timeWeight: { tw: 1, ageMonths: 0, bucketIndex: 0, isValid: false, isWithinWindow: true },
      selfInteraction: {
        isRelatedProject: false,
        isSameAuthorReply: false,
        discountConditions: 0,
        discountMultiplier: 1,
      },
      ownerBonus: { ownerUpvoted: false, ownerBonus: 1 },
    });

    expect(result).toEqual({ score: 0, scored: false });
  });
});
