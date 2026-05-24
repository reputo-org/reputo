import type { Milestone, MilestoneRecord } from './types.js';

/**
 * The `id` is omitted — the database auto-generates it.
 */
export function normalizeMilestoneToRecord(data: Milestone): Omit<MilestoneRecord, 'id'> {
  return {
    proposalId: data.proposal_id,
    title: data.title,
    status: data.status,
    description: data.description,
    developmentDescription: data.development_description,
    budget: data.budget,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    rawJson: JSON.stringify(data),
  };
}
