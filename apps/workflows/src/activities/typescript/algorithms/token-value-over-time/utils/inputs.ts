import type { AlgorithmPresetFrozenDto as AlgorithmPresetFrozen } from '@reputo/contracts';
import { extractDidsKey } from '../../shared/did-input.js';

import type { EffectiveDateRange, SelectedResourceInput, SupportedChain, TokenValueOverTimeParams } from '../types.js';

export function extractInputs(
  inputs: AlgorithmPresetFrozen['inputs'],
  snapshotCreatedAt: Date,
): TokenValueOverTimeParams {
  const maturationThresholdRaw = inputs.find((input) => input.key === 'maturation_threshold_days')?.value;
  const selectedResourcesRaw = inputs.find((input) => input.key === 'selected_resources')?.value;

  const selectedResources = (selectedResourcesRaw as Array<{ chain: string; resource_key: string }>).map((item) => ({
    chain: item.chain as SupportedChain,
    resourceKey: item.resource_key,
  })) as SelectedResourceInput[];

  const snapshotUnix = Math.floor(snapshotCreatedAt.getTime() / 1000);
  const effectiveDateRange: EffectiveDateRange = {
    fromTimestampUnix: undefined,
    toTimestampUnix: snapshotUnix,
  };

  return {
    maturationThresholdDays: maturationThresholdRaw as number,
    selectedResources,
    didsKey: extractDidsKey(inputs),
    effectiveDateRange,
  };
}
