import type { Review, ReviewRecord } from './types.js';

/**
 * The `reviewId` is omitted — the database auto-generates it.
 */
export function normalizeReviewToRecord(data: Review): Omit<ReviewRecord, 'reviewId'> {
  return {
    proposalId: data.proposal_id ?? null,
    reviewerId: data.reviewer_id ?? null,
    reviewType: data.review_type,
    overallRating: data.overall_rating,
    feasibilityRating: data.feasibility_rating,
    viabilityRating: data.viability_rating,
    desirabilityRating: data.desirability_rating,
    usefulnessRating: data.usefulness_rating,
    createdAt: data.created_at ?? null,
    rawJson: JSON.stringify(data),
  };
}
