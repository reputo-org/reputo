import type { ProposalRecord, ProposalWithRound } from './types.js';

export function normalizeProposalToRecord(data: ProposalWithRound): ProposalRecord {
  return {
    id: data.id,
    roundId: data.round_id,
    poolId: data.pool_id,
    proposerId: data.proposer_id,
    title: data.title,
    content: data.content,
    link: data.link,
    featureImage: data.feature_image,
    requestedAmount: data.requested_amount,
    awardedAmount: data.awarded_amount,
    isAwarded: data.is_awarded,
    isCompleted: data.is_completed,
    createdAt: data.created_at,
    updatedAt: data.updated_at ?? null,
    teamMembers: JSON.stringify(data.team_members || []),
    rawJson: JSON.stringify(data),
  };
}
