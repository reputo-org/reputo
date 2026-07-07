export interface ContributionScoreParams {
  commentBaseScore: number;
  commentUpvoteWeight: number;
  commentDownvoteWeight: number;
  selfInteractionPenaltyFactor: number;
  projectOwnerUpvoteBonusMultiplier: number;
  engagementWindowMonths: number;
  monthlyDecayRatePercent: number;
}

export interface ContributionScoreResult {
  did: string;
  contribution_score: number;
}

export interface CommentBenchmarkRecord {
  comment_id: number;
  user_id: number;
  proposal_id: number;
  created_at: string;
  votes: {
    upvotes: number;
    downvotes: number;
    upvoter_ids: number[];
  };
  time_weight: {
    tw: number;
    age_months: number;
    bucket_index: number;
    is_valid: boolean;
    is_within_window: boolean;
  };
  self_interaction: {
    is_related_project: boolean;
    is_same_author_reply: boolean;
    discount_conditions: number;
    discount_multiplier: number;
  };
  owner_bonus: {
    owner_upvoted: boolean;
    owner_bonus: number;
  };
  base_score: number;
  comment_score: number;
  scored: boolean;
}

export interface DidBenchmarkRecord {
  did: string;
  contribution_score: number;
  comment_count: number;
  comments: CommentBenchmarkRecord[];
}

/** Score precision for output (2 decimal places). */
export const SCORE_PRECISION = 2;

/** Round to avoid floating-point artifacts. */
export function roundScore(score: number): number {
  return Math.round(score * 10 ** SCORE_PRECISION) / 10 ** SCORE_PRECISION;
}

export interface ContributionScoreBenchmarkMetadata {
  snapshot_id: string;
  computed_at: string;
  config: ContributionScoreParams;
  dids: {
    provided_ids: string[];
    matched_ids: string[];
    unmatched_ids: string[];
  };
  metrics: {
    total_dids_provided: number;
    dids_with_matching_comments: number;
    total_comments_processed: number;
    total_comments_scored: number;
  };
}

export interface ContributionScoreBenchmark {
  dids: DidBenchmarkRecord[];
  metadata: ContributionScoreBenchmarkMetadata;
}
