import type { AlgorithmPresetFrozenDto as AlgorithmPresetFrozen } from '@reputo/contracts';

import type { ContributionScoreParams } from '../types.js';

/** Mapping from snake_case input keys to camelCase param keys. */
const KEY_MAP: Record<string, keyof ContributionScoreParams> = {
  comment_base_score: 'commentBaseScore',
  comment_upvote_weight: 'commentUpvoteWeight',
  comment_downvote_weight: 'commentDownvoteWeight',
  self_interaction_penalty_factor: 'selfInteractionPenaltyFactor',
  project_owner_upvote_bonus_multiplier: 'projectOwnerUpvoteBonusMultiplier',
  engagement_window_months: 'engagementWindowMonths',
  monthly_decay_rate_percent: 'monthlyDecayRatePercent',
};

export function extractInputs(inputs: AlgorithmPresetFrozen['inputs']): ContributionScoreParams {
  const raw = Object.fromEntries(inputs.map(({ key, value }) => [key, value])) as Record<string, unknown>;

  const params = {} as ContributionScoreParams;

  for (const [snakeKey, camelKey] of Object.entries(KEY_MAP)) {
    params[camelKey] = raw[snakeKey] as never;
  }

  return params;
}
