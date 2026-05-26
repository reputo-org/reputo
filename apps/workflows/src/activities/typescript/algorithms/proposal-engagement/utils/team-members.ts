import type { ProposalRecord } from '@reputo/deepfunding-portal-api';

export function parseTeamMembers(teamMembersJson: string): number[] {
  const raw = JSON.parse(teamMembersJson) as number[];
  return raw.map((x) => Number(x));
}

/** Returns a sorted array for deterministic output. */
export function buildProposalOwners(proposal: ProposalRecord): {
  owners: Set<number>;
  ownersArray: number[];
  teamMembersArray: number[];
} {
  const owners = new Set<number>();
  owners.add(proposal.proposerId);

  const teamMembersArray = parseTeamMembers(proposal.teamMembers).sort((a, b) => a - b);
  for (const memberId of teamMembersArray) {
    owners.add(memberId);
  }

  const ownersArray = Array.from(owners.values()).sort((a, b) => a - b);

  return { owners, ownersArray, teamMembersArray };
}
