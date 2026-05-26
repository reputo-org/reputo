import type { ProposalClassification } from '../types.js';
import type { CommunityScoreResult } from './community-scores.js';
import type { TimeWeightResult } from './time-weight.js';

/**
 * Only proposals from these rounds include reliable teamMembers data.
 * Proposals from other rounds are skipped with 'unsupported_round'.
 */
export const SUPPORTED_ROUND_IDS = new Set([31, 36, 107]);

export type ProposalSkipReason =
  | 'unsupported_round'
  | 'invalid_created_at'
  | 'outside_engagement_window'
  | 'no_community_reviews'
  | 'not_reward_or_penalty_class'
  | null;

export interface ProposalScoreInput {
  roundId: number;
  classification: ProposalClassification;
  communityScore: CommunityScoreResult;
  timeWeight: TimeWeightResult;
}

export interface ProposalScoreResult {
  proposalReward: number;
  proposalPenalty: number;
  scored: boolean;
  skipReason: ProposalSkipReason;
}

/**
 * Scoring rules:
 * - funded_concluded: reward = tw * community_norm
 * - unfunded: penalty = tw * (1 - community_norm)
 * - other: no scoring
 *
 * Skip reasons (in order of precedence):
 * 1. invalid_created_at: Date parsing failed
 * 2. outside_engagement_window: Proposal too old (tw = 0)
 * 3. no_community_reviews: No community ratings available
 * 4. not_reward_or_penalty_class: Classification is 'other'
 */
export function computeProposalScore(input: ProposalScoreInput): ProposalScoreResult {
  const { roundId, classification, communityScore, timeWeight } = input;

  let skipReason: ProposalSkipReason = null;

  if (!SUPPORTED_ROUND_IDS.has(roundId)) {
    skipReason = 'unsupported_round';
  } else if (!timeWeight.isValid) {
    skipReason = 'invalid_created_at';
  } else if (!timeWeight.isWithinWindow) {
    skipReason = 'outside_engagement_window';
  } else if (communityScore.norm === null) {
    skipReason = 'no_community_reviews';
  } else if (classification === 'other') {
    skipReason = 'not_reward_or_penalty_class';
  }

  if (skipReason !== null) {
    return {
      proposalReward: 0,
      proposalPenalty: 0,
      scored: false,
      skipReason,
    };
  }

  const tw = timeWeight.tw;
  const norm = communityScore.norm;

  if (norm === null) {
    return {
      proposalReward: 0,
      proposalPenalty: 0,
      scored: false,
      skipReason: 'no_community_reviews',
    };
  }

  let proposalReward = 0;
  let proposalPenalty = 0;

  if (classification === 'funded_concluded') {
    proposalReward = tw * norm;
  } else if (classification === 'unfunded') {
    proposalPenalty = tw * (1 - norm);
  }

  const scored = proposalReward !== 0 || proposalPenalty !== 0;

  return {
    proposalReward,
    proposalPenalty,
    scored,
    skipReason: null,
  };
}
