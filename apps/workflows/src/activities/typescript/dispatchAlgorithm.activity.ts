import type { Storage } from '@reputo/storage';
import { UnsupportedAlgorithmError } from '../../shared/errors/index.js';
import type { AlgorithmComputeFunction, AlgorithmResult, Snapshot } from '../../shared/types/index.js';
import { computeContributionScore } from './algorithms/contribution-score/compute.js';
import { computeCustomScore } from './algorithms/custom-score/compute.js';
import { computeProposalEngagement } from './algorithms/proposal-engagement/compute.js';
import { computeTokenValueOverTime } from './algorithms/token-value-over-time/compute.js';
import { computeVotingEngagement } from './algorithms/voting-engagement/compute.js';

const registry: Record<string, AlgorithmComputeFunction> = {
  voting_engagement: computeVotingEngagement,
  contribution_score: computeContributionScore,
  proposal_engagement: computeProposalEngagement,
  token_value_over_time: computeTokenValueOverTime,
  custom_score: computeCustomScore,
};

export function dispatchAlgorithm(storage: Storage) {
  return async function runTypescriptAlgorithm(snapshot: Snapshot): Promise<AlgorithmResult> {
    const algorithmKey = snapshot.algorithmPresetFrozen.key;
    const compute = registry[algorithmKey];
    if (!compute) {
      throw new UnsupportedAlgorithmError(algorithmKey);
    }
    return compute(snapshot, storage);
  };
}
