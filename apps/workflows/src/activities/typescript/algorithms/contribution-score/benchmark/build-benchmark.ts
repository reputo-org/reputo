import type { CommentRecord } from '@reputo/deepfunding-portal-api';
import type { CommentScoreResult } from '../pipeline/comment-scoring.js';
import type { OwnerBonusResult } from '../pipeline/owner-bonus.js';
import type { SelfInteractionResult } from '../pipeline/self-interaction.js';
import type { TimeWeightResult } from '../pipeline/time-weight.js';
import type { VoteStats } from '../pipeline/vote-aggregation.js';
import type {
  CommentBenchmarkRecord,
  ContributionScoreBenchmark,
  ContributionScoreParams,
  DidBenchmarkRecord,
} from '../types.js';
import { roundScore } from '../types.js';

/**
 * Build a per-comment benchmark record from pipeline outputs.
 * Converts VoteStats.upvoterIds Set to array for JSON serialization.
 * Rounds comment_score to avoid floating-point artifacts.
 */
export function buildCommentBenchmarkRecord(
  comment: CommentRecord,
  votes: VoteStats,
  timeWeight: TimeWeightResult,
  selfInteraction: SelfInteractionResult,
  ownerBonus: OwnerBonusResult,
  scoreResult: CommentScoreResult,
  baseScore: number,
): CommentBenchmarkRecord {
  const commentScore = scoreResult.scored ? roundScore(scoreResult.score) : 0;
  return {
    comment_id: comment.commentId,
    user_id: comment.userId,
    proposal_id: comment.proposalId,
    created_at: comment.createdAt,
    votes: {
      upvotes: votes.upvotes,
      downvotes: votes.downvotes,
      upvoter_ids: Array.from(votes.upvoterIds),
    },
    time_weight: {
      tw: timeWeight.tw,
      age_months: timeWeight.ageMonths,
      bucket_index: timeWeight.bucketIndex,
      is_valid: timeWeight.isValid,
      is_within_window: timeWeight.isWithinWindow,
    },
    self_interaction: {
      is_related_project: selfInteraction.isRelatedProject,
      is_same_author_reply: selfInteraction.isSameAuthorReply,
      discount_conditions: selfInteraction.discountConditions,
      discount_multiplier: selfInteraction.discountMultiplier,
    },
    owner_bonus: {
      owner_upvoted: ownerBonus.ownerUpvoted,
      owner_bonus: ownerBonus.ownerBonus,
    },
    base_score: baseScore,
    comment_score: commentScore,
    scored: scoreResult.scored,
  };
}

export interface FormatBenchmarkInput {
  records: CommentBenchmarkRecord[];
  snapshotId: string;
  dids: string[];
  didScores: Map<string, number>;
  matchedDids: Set<string>;
  /** Portal user id → DID, to attribute each comment's author to a DID. */
  userIdToDid: Map<number, string>;
  params: ContributionScoreParams;
  totalCommentsProcessed: number;
  totalCommentsScored: number;
}

/**
 * Aggregate benchmark records by user and format into the final output structure.
 * Uses users table as source: only includes users present in userIdsInResult.
 * Populates metadata with included/excluded user ids, config, and metrics.
 */
export function formatBenchmarkOutput(input: FormatBenchmarkInput): ContributionScoreBenchmark {
  const {
    records,
    snapshotId,
    dids,
    didScores,
    matchedDids,
    userIdToDid,
    params,
    totalCommentsProcessed,
    totalCommentsScored,
  } = input;

  const didMap = new Map<string, CommentBenchmarkRecord[]>();

  for (const record of records) {
    const did = userIdToDid.get(record.user_id);
    if (did === undefined) {
      continue;
    }
    const list = didMap.get(did) ?? [];
    list.push(record);
    didMap.set(did, list);
  }

  const didRows: DidBenchmarkRecord[] = [];

  for (const did of dids) {
    const comments = didMap.get(did) ?? [];
    const contributionScore = didScores.get(did) ?? 0;
    didRows.push({
      did: did,
      contribution_score: contributionScore,
      comment_count: comments.length,
      comments,
    });
  }

  didRows.sort((a, b) => a.did.localeCompare(b.did));
  const matchedIds = [...matchedDids].sort((a, b) => a.localeCompare(b));
  const unmatchedIds = dids.filter((did) => !matchedDids.has(did));

  return {
    dids: didRows,
    metadata: {
      snapshot_id: snapshotId,
      computed_at: new Date().toISOString(),
      config: {
        commentBaseScore: params.commentBaseScore,
        commentUpvoteWeight: params.commentUpvoteWeight,
        commentDownvoteWeight: params.commentDownvoteWeight,
        selfInteractionPenaltyFactor: params.selfInteractionPenaltyFactor,
        projectOwnerUpvoteBonusMultiplier: params.projectOwnerUpvoteBonusMultiplier,
        engagementWindowMonths: params.engagementWindowMonths,
        monthlyDecayRatePercent: params.monthlyDecayRatePercent,
      },
      dids: {
        provided_ids: dids,
        matched_ids: matchedIds,
        unmatched_ids: unmatchedIds,
      },
      metrics: {
        total_dids_provided: dids.length,
        dids_with_matching_comments: matchedIds.length,
        total_comments_processed: totalCommentsProcessed,
        total_comments_scored: totalCommentsScored,
      },
    },
  };
}
