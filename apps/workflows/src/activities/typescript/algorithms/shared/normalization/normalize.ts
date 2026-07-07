import { fromUnitIntervalStrategy, minMaxStrategy } from './strategies.js';
import { type NormalizationMethod, type NormalizationStrategy, SCORE_RANGE, type ScoreRange } from './types.js';

/**
 * Registry of normalization methods. Add a new method (e.g. `z_score`, `sigmoid`,
 * `percentile`) by implementing a {@link NormalizationStrategy} and registering it
 * here plus in the {@link NormalizationMethod} union — every call site is unchanged.
 */
const STRATEGIES = new Map<NormalizationMethod, NormalizationStrategy>([
  ['min_max', minMaxStrategy],
  ['from_unit_interval', fromUnitIntervalStrategy],
]);

export function getNormalizationStrategy(method: NormalizationMethod): NormalizationStrategy {
  const strategy = STRATEGIES.get(method);
  if (!strategy) {
    throw new Error(`Unknown normalization method: ${method}`);
  }
  return strategy;
}

/**
 * Normalize a vector of raw per-user scores into `range` (defaults to the canonical
 * 0–100 {@link SCORE_RANGE}) using `method`. Output is index-aligned with the input.
 */
export function normalizeScores(
  values: readonly number[],
  method: NormalizationMethod,
  range: ScoreRange = SCORE_RANGE,
): number[] {
  return getNormalizationStrategy(method).normalize(values, range);
}
