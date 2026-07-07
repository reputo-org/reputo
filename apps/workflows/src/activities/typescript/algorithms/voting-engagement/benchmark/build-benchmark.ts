import type { VoteGroupingStats } from '../pipeline/vote-grouping.js';
import {
  type DidBenchmarkRecord,
  roundScore,
  VALID_VOTES,
  type ValidVote,
  type VotingEngagementBenchmark,
} from '../types.js';

export function buildVoterBenchmarkRecord(
  did: string,
  voterVotes: ValidVote[],
  votingEngagement: number,
  collectionIds: string[] = [],
): DidBenchmarkRecord {
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
    did: did,
    collection_ids: collectionIds,
    total_votes: totalVotes,
    vote_distribution: voteDistribution,
    entropy: roundScore(entropy),
    voting_engagement: votingEngagement,
  };
}

export interface FormatBenchmarkInput {
  records: DidBenchmarkRecord[];
  snapshotId: string;
  stats: VoteGroupingStats;
  matchedDids: Set<string>;
}

export function formatBenchmarkOutput(input: FormatBenchmarkInput): VotingEngagementBenchmark {
  const { records, snapshotId, stats, matchedDids } = input;

  const sortedRecords = [...records].sort((a, b) => a.did.localeCompare(b.did));
  const providedIds = sortedRecords.map((record) => record.did);
  const matchedIds = [...matchedDids].sort((a, b) => a.localeCompare(b));
  const unmatchedIds = providedIds.filter((did) => !matchedDids.has(did));

  return {
    dids: sortedRecords,
    metadata: {
      snapshot_id: snapshotId,
      computed_at: new Date().toISOString(),
      dids: {
        provided_ids: providedIds,
        matched_ids: matchedIds,
        unmatched_ids: unmatchedIds,
      },
      metrics: {
        total_votes_in_file: stats.totalVotes,
        valid_votes: stats.validVotes,
        invalid_votes: stats.invalidVotes,
        targeted_voter_ids: stats.targetedVoterIds,
        dids_with_votes: matchedIds.length,
      },
    },
  };
}
