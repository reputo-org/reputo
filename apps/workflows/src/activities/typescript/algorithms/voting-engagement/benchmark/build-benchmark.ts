import type { VoteGroupingStats } from '../pipeline/vote-grouping.js';
import {
  roundScore,
  type SubIdBenchmarkRecord,
  VALID_VOTES,
  type ValidVote,
  type VotingEngagementBenchmark,
} from '../types.js';

export function buildVoterBenchmarkRecord(
  subId: string,
  deepVotingPortalId: string | null,
  voterVotes: ValidVote[],
  votingEngagement: number,
): SubIdBenchmarkRecord {
  const totalVotes = voterVotes.length;

  const voteDistribution = Object.fromEntries(VALID_VOTES.map((v) => [v, 0])) as Record<ValidVote, number>;
  for (const vote of voterVotes) {
    voteDistribution[vote]++;
  }

  let entropy = 0;
  if (totalVotes > 0) {
    for (const count of Object.values(voteDistribution)) {
      if (count > 0) {
        const prob = count / totalVotes;
        entropy -= prob * Math.log2(prob);
      }
    }
  }

  return {
    sub_id: subId,
    deep_voting_portal_id: deepVotingPortalId,
    total_votes: totalVotes,
    vote_distribution: voteDistribution,
    entropy: roundScore(entropy),
    voting_engagement: votingEngagement,
  };
}

export interface FormatBenchmarkInput {
  records: SubIdBenchmarkRecord[];
  snapshotId: string;
  stats: VoteGroupingStats;
  matchedSubIds: Set<string>;
}

export function formatBenchmarkOutput(input: FormatBenchmarkInput): VotingEngagementBenchmark {
  const { records, snapshotId, stats, matchedSubIds } = input;

  const sortedRecords = [...records].sort((a, b) => a.sub_id.localeCompare(b.sub_id));
  const providedIds = sortedRecords.map((record) => record.sub_id);
  const matchedIds = [...matchedSubIds].sort((a, b) => a.localeCompare(b));
  const unmatchedIds = providedIds.filter((subId) => !matchedSubIds.has(subId));

  return {
    sub_ids: sortedRecords,
    metadata: {
      snapshot_id: snapshotId,
      computed_at: new Date().toISOString(),
      sub_ids: {
        provided_ids: providedIds,
        matched_ids: matchedIds,
        unmatched_ids: unmatchedIds,
      },
      metrics: {
        total_votes_in_file: stats.totalVotes,
        valid_votes: stats.validVotes,
        invalid_votes: stats.invalidVotes,
        targeted_voter_ids: stats.targetedVoterIds,
        sub_ids_with_votes: matchedIds.length,
      },
    },
  };
}
