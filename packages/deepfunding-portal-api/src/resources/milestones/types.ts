import type { Pagination, PaginationOptions } from '../../shared/types/index.js';

export type MilestoneStatus = 'not_started' | 'pending' | 'in_progress' | 'completed';

/**
 * Individual milestone object as returned by the API. Does not include
 * proposal_id/created_at/updated_at — those live at the group level in the API
 * response and are merged in by {@link fetchMilestones}.
 */
export type MilestoneRaw = {
  id: number;
  title: string;
  status: MilestoneStatus;
  description: string;
  development_description: string;
  budget: number;
  [key: string]: unknown;
};

/**
 * Milestone enriched with the group-level proposal metadata.
 */
export type Milestone = {
  id: number;
  proposal_id: number;
  title: string;
  status: MilestoneStatus;
  description: string;
  development_description: string;
  budget: number;
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
};

/**
 * The API returns milestones grouped by proposal.
 */
export type MilestoneApiResponse = {
  milestones: Array<{
    proposal_id: number;
    created_at: string;
    updated_at: string;
    milestones: MilestoneRaw[];
  }>;
  pagination: Pagination;
};

export type MilestoneRecord = {
  id: number;
  proposalId: number;
  title: string;
  status: string;
  description: string;
  developmentDescription: string;
  budget: number;
  createdAt: string | null;
  updatedAt: string | null;
  rawJson: string;
};

export type MilestoneFetchOptions = PaginationOptions & {
  proposalId?: number;
  status?: MilestoneStatus;
};
