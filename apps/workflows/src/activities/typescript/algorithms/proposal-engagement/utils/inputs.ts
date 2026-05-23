import type { AlgorithmPresetFrozenDto as AlgorithmPresetFrozen } from '@reputo/contracts';
import { extractSubIdsKey } from '../../shared/sub-id-input.js';

import type { ProposalEngagementParams } from '../types.js';

const KEY_MAP: Record<string, keyof ProposalEngagementParams> = {
  funded_concluded_reward_weight: 'fundedConcludedRewardWeight',
  unfunded_penalty_weight: 'unfundedPenaltyWeight',
  engagement_window_months: 'engagementWindowMonths',
  monthly_decay_rate_percent: 'monthlyDecayRatePercent',
};

export function extractInputs(inputs: AlgorithmPresetFrozen['inputs']): ProposalEngagementParams {
  const raw = Object.fromEntries(inputs.map(({ key, value }) => [key, value])) as Record<string, unknown>;

  const params = {
    subIdsKey: extractSubIdsKey(inputs),
  } as ProposalEngagementParams;

  for (const [snakeKey, camelKey] of Object.entries(KEY_MAP)) {
    params[camelKey] = raw[snakeKey] as never;
  }

  return params;
}
