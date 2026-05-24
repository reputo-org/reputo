import type { VoteStats } from './vote-aggregation.js';

export interface OwnerBonusResult {
  ownerUpvoted: boolean;
  ownerBonus: number;
}

export function computeOwnerBonus(
  proposalId: number,
  votes: VoteStats,
  projectOwnerMap: Map<number, Set<number>>,
  bonusMultiplier: number,
): OwnerBonusResult {
  const projectOwners = projectOwnerMap.get(proposalId);

  if (!projectOwners) {
    return { ownerUpvoted: false, ownerBonus: 1 };
  }

  for (const upvoterId of votes.upvoterIds) {
    if (projectOwners.has(upvoterId)) {
      return { ownerUpvoted: true, ownerBonus: bonusMultiplier };
    }
  }

  return { ownerUpvoted: false, ownerBonus: 1 };
}
