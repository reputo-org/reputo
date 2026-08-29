import type { CommunityFetchInput } from '../types/index.js';

const DAY_MS = 86_400_000;

/** Doc rule: community lookback windows are capped at 183 days (6 months). */
export const MAX_COMMUNITY_LOOKBACK_DAYS = 183;

interface AlgorithmPresetFrozenLike {
  key?: string;
  inputs: Array<{ key: string; value?: unknown }>;
}

/**
 * Builds a community fetch input from the frozen preset: the selected
 * resource ids plus the window `[end − lookback_days, end)`, where `end` is
 * the workflow start time — deterministic, identical on every retry, and
 * never re-derived from a wall clock.
 */
export function extractCommunityFetchInput(preset: AlgorithmPresetFrozenLike, windowEnd: Date): CommunityFetchInput {
  const presetLabel = preset.key ?? 'unknown';

  const lookbackValue = preset.inputs.find((input) => input.key === 'lookback_days')?.value;
  if (
    typeof lookbackValue !== 'number' ||
    !Number.isInteger(lookbackValue) ||
    lookbackValue < 1 ||
    lookbackValue > MAX_COMMUNITY_LOOKBACK_DAYS
  ) {
    throw new Error(
      `Preset "${presetLabel}" needs a "lookback_days" input between 1 and ${MAX_COMMUNITY_LOOKBACK_DAYS}, got ${JSON.stringify(lookbackValue)}`,
    );
  }

  const resourcesValue = preset.inputs.find((input) => input.key === 'resources')?.value;
  const resourceIds =
    Array.isArray(resourcesValue) && resourcesValue.every((entry): entry is string => typeof entry === 'string')
      ? resourcesValue
      : undefined;
  if (resourceIds === undefined || resourceIds.length === 0) {
    throw new Error(`Preset "${presetLabel}" needs a non-empty "resources" input of platform resource ids`);
  }

  return {
    resourceIds: [...new Set(resourceIds)],
    windowStart: new Date(windowEnd.getTime() - lookbackValue * DAY_MS).toISOString(),
    windowEnd: windowEnd.toISOString(),
  };
}
