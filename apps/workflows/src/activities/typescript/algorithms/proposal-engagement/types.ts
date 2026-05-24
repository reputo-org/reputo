export interface ProposalEngagementParams {
  subIdsKey: string;
  fundedConcludedRewardWeight: number;
  unfundedPenaltyWeight: number;
  engagementWindowMonths: number;
  monthlyDecayRatePercent: number;
}

export interface ProposalEngagementResult {
  sub_id: string;
  proposal_engagement: number;
}

export type ProposalClassification = 'funded_concluded' | 'unfunded' | 'other';

export const SCORE_PRECISION = 2;

export function roundScore(score: number): number {
  return Math.round(score * 10 ** SCORE_PRECISION) / 10 ** SCORE_PRECISION;
}

export interface ProposalBenchmarkRecord {
  proposal_id: number;
  round_id: number;
  created_at: string;
  owners: {
    proposer_id: number;
    team_member_ids: number[];
    all_owner_ids: number[];
  };
  classification: {
    is_awarded: boolean;
    is_completed: boolean;
    classification: ProposalClassification;
  };
  community_score: {
    count: number;
    avg: number | null;
    norm: number | null;
  };
  time_weight: {
    tw: number;
    age_months: number;
    bucket_index: number;
    is_valid: boolean;
    is_within_window: boolean;
  };
  score: {
    proposal_reward: number;
    proposal_penalty: number;
    scored: boolean;
    skip_reason: string | null;
  };
}

export interface SubIdProposalBenchmarkRecord {
  sub_id: string;
  deep_proposal_portal_id: string | null;
  proposal_engagement: number;
  positive_sum: number;
  negative_sum: number;
  proposal_count: number;
  proposals: ProposalBenchmarkRecord[];
}

export interface ProposalEngagementBenchmarkMetadata {
  snapshot_id: string;
  computed_at: string;
  config: Omit<ProposalEngagementParams, 'subIdsKey'>;
  sub_ids: {
    provided_ids: string[];
    matched_ids: string[];
    unmatched_ids: string[];
  };
  metrics: {
    total_sub_ids_provided: number;
    sub_ids_with_matching_owner: number;
    total_proposals_processed: number;
    total_proposals_scored: number;
    proposals_skipped_unsupported_round: number;
  };
}

export interface ProposalEngagementBenchmark {
  sub_ids: SubIdProposalBenchmarkRecord[];
  metadata: ProposalEngagementBenchmarkMetadata;
}
