export interface VoteRecord {
  id?: number;
  event_id?: number;
  answer: string;
  created_on?: string;
  updated_on?: string;
  question_id: string;
  balance?: number;
  stake?: number;
  collection_id: string;
  vote_id?: number;
}

export interface VotingEngagementResult {
  did: string;
  voting_engagement: number;
}

export interface VotingEngagementComputeLogger {
  info: (message: string, context?: Record<string, unknown>) => void;
}
