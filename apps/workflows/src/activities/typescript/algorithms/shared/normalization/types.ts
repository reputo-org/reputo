/** Inclusive numeric range a normalization strategy maps scores into. */
export interface ScoreRange {
  readonly min: number;
  readonly max: number;
}

/**
 * The canonical range every reputation algorithm normalizes its final per-user
 * score into. Fixed for now (not user-configurable); centralized here so a future
 * change is a single edit.
 */
export const SCORE_RANGE: ScoreRange = { min: 0, max: 100 };

/**
 * Maps a vector of raw per-user scores into `range`. Implementations MUST be pure
 * and index-preserving: `output[i]` is the normalized score for `input[i]`.
 */
export interface NormalizationStrategy {
  normalize(values: readonly number[], range: ScoreRange): number[];
}

/**
 * Registered normalization methods. Extend the union (and the registry in
 * `normalize.ts`) to add a new method — every call site keeps working unchanged.
 */
export type NormalizationMethod = 'min_max' | 'from_unit_interval';
