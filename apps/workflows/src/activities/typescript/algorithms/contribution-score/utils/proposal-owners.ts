import type { ProposalRecord } from '@reputo/deepfunding-portal-api';

export function parseTeamMembers(teamMembersJson: string): number[] {
  const raw = JSON.parse(teamMembersJson) as number[];
  return raw.map((x) => Number(x));
}

/** Key format: `${userId}-${proposalId}` */
export function buildRelationMap(proposals: ProposalRecord[]): Map<string, boolean> {
  const relationMap = new Map<string, boolean>();

  for (const proposal of proposals) {
    relationMap.set(`${proposal.proposerId}-${proposal.id}`, true);

    const teamMembers = parseTeamMembers(proposal.teamMembers);
    for (const memberId of teamMembers) {
      relationMap.set(`${memberId}-${proposal.id}`, true);
    }
  }

  return relationMap;
}

export function buildProjectOwnerMap(proposals: ProposalRecord[]): Map<number, Set<number>> {
  const ownerMap = new Map<number, Set<number>>();

  for (const proposal of proposals) {
    const owners = new Set<number>();
    owners.add(proposal.proposerId);

    const teamMembers = parseTeamMembers(proposal.teamMembers);
    for (const memberId of teamMembers) {
      owners.add(memberId);
    }

    ownerMap.set(proposal.id, owners);
  }

  return ownerMap;
}
