import { MAX_VOTING_ENTROPY, VALID_VOTES, type ValidVote } from '../types.js';

/**
 * Engagement is normalized entropy of vote distribution across 11 categories.
 * Higher entropy = more varied voting = higher engagement.
 */
export function calculateVotingEngagement(voterVotes: ValidVote[]): number {
  const totalVotes = voterVotes.length;

  if (totalVotes === 0) {
    return 0;
  }

  const voteCounts = new Array(11).fill(0) as number[];
  for (const voteValue of voterVotes) {
    const index = VALID_VOTES.indexOf(voteValue);
    if (index >= 0) {
      voteCounts[index]++;
    }
  }

  const probabilities = voteCounts.map((count) => count / totalVotes);

  let entropy = 0;
  for (const prob of probabilities) {
    if (prob > 0) {
      entropy -= prob * Math.log2(prob);
    }
  }

  return entropy / MAX_VOTING_ENTROPY;
}
