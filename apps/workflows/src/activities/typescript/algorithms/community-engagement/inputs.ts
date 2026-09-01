import type { AlgorithmPresetFrozenDto } from '@reputo/contracts';
import type { ActivityWeight } from './types.js';

type FrozenInputs = AlgorithmPresetFrozenDto['inputs'];

/**
 * Extracts the `activities` weight rows from the frozen preset, validated
 * against the platform's activity enum. Weights must be positive — a zero
 * weight is invalid app-wide; disabling an activity means leaving its row out.
 * The returned map iterates in the canonical activity order, which is the
 * fixed order weights are applied in.
 */
export function extractActivityWeights(
  inputs: FrozenInputs,
  activityTypes: readonly string[],
): Map<string, ActivityWeight> {
  const value = inputs.find((input) => input.key === 'activities')?.value;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('Missing required "activities" input: add at least one activity weight row');
  }

  const byType = new Map<string, ActivityWeight>();
  for (const row of value) {
    if (typeof row !== 'object' || row === null) {
      throw new Error('Every "activities" row must be an object with activity, points, and daily_cap');
    }
    const { activity, points, daily_cap: dailyCap } = row as Record<string, unknown>;

    if (typeof activity !== 'string' || !activityTypes.includes(activity)) {
      throw new Error(
        `Unknown activity ${JSON.stringify(activity)} in "activities"; supported: ${activityTypes.join(', ')}`,
      );
    }
    if (byType.has(activity)) {
      throw new Error(`Activity "${activity}" appears more than once in "activities"`);
    }
    if (typeof points !== 'number' || !Number.isFinite(points) || points <= 0) {
      throw new Error(`Activity "${activity}" needs points greater than 0, got ${JSON.stringify(points)}`);
    }
    if (typeof dailyCap !== 'number' || !Number.isInteger(dailyCap) || dailyCap < 1) {
      throw new Error(
        `Activity "${activity}" needs an integer daily_cap of at least 1, got ${JSON.stringify(dailyCap)}`,
      );
    }

    byType.set(activity, { points, dailyCap });
  }

  const ordered = new Map<string, ActivityWeight>();
  for (const type of activityTypes) {
    const weight = byType.get(type);
    if (weight !== undefined) {
      ordered.set(type, weight);
    }
  }
  return ordered;
}
