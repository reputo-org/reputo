import type { AlgorithmPresetFrozenDto as AlgorithmPresetFrozen } from '@reputo/contracts';
import { extractSubIdsKey } from '../../shared/sub-id-input.js';

/**
 * Extract the storage keys required by voting engagement.
 *
 * @param inputs - Raw inputs from the algorithm preset
 * @returns The storage keys for the SubID JSON and votes CSV files
 */
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
