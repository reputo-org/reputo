import type { AlgorithmPresetFrozenDto as AlgorithmPresetFrozen } from '@reputo/contracts';
import { extractSubIdsKey } from '../../shared/sub-id-input.js';

export function extractInputKeys(inputs: AlgorithmPresetFrozen['inputs']): {
  subIdsKey: string;
  votesKey: string;
} {
  const votesInput = inputs.find((input) => input.key === 'votes');
  if (votesInput == null || typeof votesInput.value !== 'string') {
    throw new Error('Missing required "votes" input');
  }

  return {
    subIdsKey: extractSubIdsKey(inputs),
    votesKey: votesInput.value,
  };
}
