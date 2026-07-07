import type { NormalizationStrategy, ScoreRange } from './types.js';

/** Min and max of a non-empty vector (single pass, avoids `Math.min(...huge)`). */
function extent(values: readonly number[]): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

/** Map a ratio in [0, 1] onto `range`. */
function scaleUnit(ratio: number, range: ScoreRange): number {
  return range.min + ratio * (range.max - range.min);
}

/**
 * Cohort min–max: the lowest observed score maps to `range.min`, the highest to
 * `range.max`, the rest interpolate linearly. Scores become relative to the scored
 * population (a user's number depends on who else is in the snapshot). When there
 * is no spread — empty, single-member, or all-equal cohort — every score collapses
 * to `range.min`.
 */
export const minMaxStrategy: NormalizationStrategy = {
  normalize(values, range) {
    if (values.length === 0) return [];
    const { min, max } = extent(values);
    if (max === min) return values.map(() => range.min);
    const span = max - min;
    return values.map((value) => scaleUnit((value - min) / span, range));
  },
};

/**
 * Linear rescale of scores that already live on the unit interval [0, 1] (e.g. an
 * already-normalized entropy score) onto `range`. Unlike min–max this preserves
 * absolute meaning and comparability across cohorts — it does not re-relativize the
 * scores to the current population. Inputs are clamped to [0, 1] defensively.
 */
export const fromUnitIntervalStrategy: NormalizationStrategy = {
  normalize(values, range) {
    return values.map((value) => scaleUnit(Math.min(1, Math.max(0, value)), range));
  },
};
