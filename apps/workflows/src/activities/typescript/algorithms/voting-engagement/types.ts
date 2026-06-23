export interface VotingEngagementResult {
  did: string;
  voting_engagement: number;
}

/** Valid vote values (skip or 1-10). */
export const VALID_VOTES = ['skip', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'] as const;

export type ValidVote = (typeof VALID_VOTES)[number];

/** Maximum possible Shannon entropy for 11 vote categories. */
export const MAX_VOTING_ENTROPY = Math.log2(11);

/** Score precision for output (6 decimal places — entropy needs more precision than 2dp). */
export const SCORE_PRECISION = 6;

/** Round to avoid floating-point artifacts. */
export function roundScore(score: number): number {
  return Math.round(score * 10 ** SCORE_PRECISION) / 10 ** SCORE_PRECISION;
}

export interface DidBenchmarkRecord {
  did: string;
  /** Collection IDs the DID resolved to (wallet → wallet_collections.csv). */
  collection_ids?: string[];
  total_votes: number;
  vote_distribution: Record<ValidVote, number>;
  entropy: number;
  voting_engagement: number;
}

export interface VotingEngagementBenchmarkMetadata {
  snapshot_id: string;
  computed_at: string;
  dids: {
    provided_ids: string[];
    matched_ids: string[];
    unmatched_ids: string[];
  };
  metrics: {
    total_votes_in_file: number;
    valid_votes: number;
    invalid_votes: number;
    targeted_voter_ids: number;
    dids_with_votes: number;
  };
}

export interface VotingEngagementBenchmark {
  dids: DidBenchmarkRecord[];
  metadata: VotingEngagementBenchmarkMetadata;
}
