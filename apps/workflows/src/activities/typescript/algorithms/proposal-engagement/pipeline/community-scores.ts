import type { ReviewRecord } from '@reputo/deepfunding-portal-api';

export interface CommunityRatingStats {
  sum: number;
  count: number;
}

export interface CommunityScoreResult {
  count: number;
  avg: number | null;
  norm: number | null;
}

/** Only considers reviews with reviewType === 'community' and valid positive ratings. */
export function aggregateCommunityRatings(reviews: ReviewRecord[]): Map<number, CommunityRatingStats> {
  const byProposal = new Map<number, CommunityRatingStats>();

  for (const review of reviews) {
    if (review.reviewType !== 'community') continue;
    if (!review.proposalId) continue;

    const rating = Number.parseFloat(review.overallRating);

    const entry = byProposal.get(review.proposalId) ?? { sum: 0, count: 0 };
    entry.sum += rating;
    entry.count += 1;
    byProposal.set(review.proposalId, entry);
  }

  return byProposal;
}

/**
 * - avg: average rating (sum / count)
 * - norm: normalized score (avg / 5, assuming 5 is max rating)
 */
export function computeCommunityScore(
  proposalId: number,
  ratingStats: Map<number, CommunityRatingStats>,
): CommunityScoreResult {
  const stats = ratingStats.get(proposalId);
  const count = stats?.count ?? 0;

  if (count === 0 || !stats) {
    return { count: 0, avg: null, norm: null };
  }

  const avg = stats.sum / count;
  const norm = avg / 5; // Normalize to 0-1 range assuming 5 is max

  return { count, avg, norm };
}
