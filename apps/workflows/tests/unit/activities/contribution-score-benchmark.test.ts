import { describe, expect, it } from 'vitest';
import {
  buildCommentBenchmarkRecord,
  formatBenchmarkOutput,
} from '../../../src/activities/typescript/algorithms/contribution-score/benchmark/index.js';
import type { CommentBenchmarkRecord } from '../../../src/activities/typescript/algorithms/contribution-score/types.js';

const mockComment = {
  commentId: 100,
  parentId: 0,
  isReply: false,
  userId: 42,
  proposalId: 5,
  content: 'Test comment',
  commentVotes: '0',
  createdAt: '2026-01-15T10:00:00.000Z',
  updatedAt: '2026-01-15T10:00:00.000Z',
  rawJson: '{}',
};

const mockVotes = {
  upvotes: 3,
  downvotes: 0,
  upvoterIds: new Set([1, 2, 3]),
};

const mockTimeWeight = {
  tw: 0.9,
  ageMonths: 2.5,
  bucketIndex: 2,
  isValid: true,
  isWithinWindow: true,
};

const mockSelfInteraction = {
  isRelatedProject: false,
  isSameAuthorReply: false,
  discountConditions: 0,
  discountMultiplier: 1,
};

const mockOwnerBonus = {
  ownerUpvoted: true,
  ownerBonus: 1.2,
};

const mockParams = {
  commentBaseScore: 10,
  commentUpvoteWeight: 1,
  commentDownvoteWeight: 1,
  selfInteractionPenaltyFactor: 1,
  projectOwnerUpvoteBonusMultiplier: 1.2,
  engagementWindowMonths: 12,
  monthlyDecayRatePercent: 10,
};

describe('contribution-score benchmark', () => {
  describe('buildCommentBenchmarkRecord', () => {
    it('builds a JSON-serializable record with rounded scores', () => {
      const result = buildCommentBenchmarkRecord(
        mockComment,
        mockVotes,
        mockTimeWeight,
        mockSelfInteraction,
        mockOwnerBonus,
        { score: 12.96, scored: true },
        10.8,
      );

      expect(result.comment_score).toBe(12.96);
      expect(result.votes.upvoter_ids).toEqual([1, 2, 3]);
    });
  });

  describe('formatBenchmarkOutput', () => {
    const baseRecord: CommentBenchmarkRecord = {
      comment_id: 0,
      user_id: 0,
      proposal_id: 0,
      created_at: '',
      votes: { upvotes: 0, downvotes: 0, upvoter_ids: [] },
      time_weight: {
        tw: 0,
        age_months: 0,
        bucket_index: 0,
        is_valid: true,
        is_within_window: true,
      },
      self_interaction: {
        is_related_project: false,
        is_same_author_reply: false,
        discount_conditions: 0,
        discount_multiplier: 1,
      },
      owner_bonus: { owner_upvoted: false, owner_bonus: 1 },
      base_score: 0,
      comment_score: 0,
      scored: false,
    };

    it('includes metadata with matched and unmatched SubIDs, config, and metrics', () => {
      const records: CommentBenchmarkRecord[] = [
        {
          ...baseRecord,
          comment_id: 1,
          user_id: 10,
          base_score: 12,
          comment_score: 12,
          scored: true,
        },
        {
          ...baseRecord,
          comment_id: 2,
          user_id: 35,
          base_score: 5,
          comment_score: 5,
          scored: true,
        },
      ];

      const result = formatBenchmarkOutput({
        records,
        snapshotId: 'snap-123',
        dids: ['SubID-10', 'SubID-35', 'SubID-100'],
        didScores: new Map([
          ['SubID-10', 12],
          ['SubID-35', 5],
          ['SubID-100', 0],
        ]),
        matchedDids: new Set(['SubID-10', 'SubID-35']),
        userIdToDid: new Map([
          [10, 'SubID-10'],
          [35, 'SubID-35'],
          [100, 'SubID-100'],
        ]),
        params: mockParams,
        totalCommentsProcessed: 2,
        totalCommentsScored: 2,
      });

      expect(result.dids).toHaveLength(3);
      expect(result.metadata.snapshot_id).toBe('snap-123');
      expect(result.metadata.config).toEqual(mockParams);
      expect(result.metadata.dids.provided_ids).toEqual(['SubID-10', 'SubID-35', 'SubID-100']);
      expect(result.metadata.dids.matched_ids).toEqual(['SubID-10', 'SubID-35']);
      expect(result.metadata.dids.unmatched_ids).toEqual(['SubID-100']);
      expect(result.metadata.metrics.total_dids_provided).toBe(3);
      expect(result.metadata.metrics.dids_with_matching_comments).toBe(2);
      expect(result.metadata.metrics.total_comments_processed).toBe(2);
      expect(result.metadata.metrics.total_comments_scored).toBe(2);
    });

    it('includes only the provided SubIDs', () => {
      const records: CommentBenchmarkRecord[] = [
        { ...baseRecord, comment_id: 1, user_id: 4, comment_score: 24.5, scored: true },
        { ...baseRecord, comment_id: 2, user_id: 35, comment_score: 5, scored: true },
      ];

      const result = formatBenchmarkOutput({
        records,
        snapshotId: 'snap-789',
        dids: ['SubID-35'],
        didScores: new Map([['SubID-35', 5]]),
        matchedDids: new Set(['SubID-35']),
        userIdToDid: new Map([[35, 'SubID-35']]),
        params: mockParams,
        totalCommentsProcessed: 2,
        totalCommentsScored: 2,
      });

      expect(result.dids).toHaveLength(1);
      const [did] = result.dids;
      expect(did).toBeDefined();
      expect(did?.did).toBe('SubID-35');
      expect(did?.contribution_score).toBe(5);
    });
  });
});
