import type { AlgorithmPresetFrozenDto as AlgorithmPresetFrozen } from '@reputo/contracts';
import { extractDidsKey } from '../../shared/did-input.js';

export function extractInputKeys(inputs: AlgorithmPresetFrozen['inputs']): {
  didsKey: string;
  votesKey: string;
  walletCollectionsKey: string;
} {
  const votesInput = inputs.find((input) => input.key === 'votes');
  if (votesInput == null || typeof votesInput.value !== 'string') {
    throw new Error('Missing required "votes" input');
  }

  const walletCollectionsInput = inputs.find((input) => input.key === 'wallet_collections');
  if (walletCollectionsInput == null || typeof walletCollectionsInput.value !== 'string') {
    throw new Error('Missing required "wallet_collections" input');
  }

  return {
    didsKey: extractDidsKey(inputs),
    votesKey: votesInput.value,
    walletCollectionsKey: walletCollectionsInput.value,
  };
}
