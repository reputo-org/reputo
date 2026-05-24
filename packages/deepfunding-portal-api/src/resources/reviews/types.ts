import type { Pagination, PaginationOptions } from '../../shared/types/index.js';

export type ReviewType = 'expert' | 'community';

export type Review = {
  review_id: number;
  proposal_id: number;
  reviewer_id: number;
  review_type: ReviewType;
  overall_rating: string;
  feasibility_rating: string;
  viability_rating: string;
  desirability_rating: string;
  usefulness_rating: string;
  created_at: string;
  [key: string]: unknown;
};

export type ReviewApiResponse = {
  reviews: Review[];
  pagination: Pagination;
};

export type ReviewRecord = {
  reviewId: number;
  proposalId: number | null;
  reviewerId: number | null;
  reviewType: string;
  overallRating: string;
  feasibilityRating: string;
  viabilityRating: string;
  desirabilityRating: string;
  usefulnessRating: string;
  createdAt: string | null;
  rawJson: string;
};

export type ReviewFetchOptions = PaginationOptions;
