import { describe, expect, it } from 'vitest';

import {
  getNormalizationStrategy,
  normalizeScores,
  SCORE_RANGE,
} from '../../../../src/activities/typescript/algorithms/shared/normalization/index.js';

describe('SCORE_RANGE', () => {
  it('is the canonical 0–100 range', () => {
    expect(SCORE_RANGE).toEqual({ min: 0, max: 100 });
  });
});

describe('normalizeScores — min_max', () => {
  it('maps the lowest score to 0 and the highest to 100', () => {
    expect(normalizeScores([10, 20, 30], 'min_max')).toEqual([0, 50, 100]);
  });

  it('maps negative scores by treating the most negative as the floor', () => {
    // min -0.4 → 0, max 1.8 → 100, and 0.7 sits at (0.7 + 0.4) / 2.2 = 0.5.
    expect(normalizeScores([1.8, -0.4, 0.7], 'min_max')).toEqual([100, 0, 50]);
  });

  it('is index-aligned with the input regardless of order', () => {
    expect(normalizeScores([30, 0, 15], 'min_max')).toEqual([100, 0, 50]);
  });

  it('collapses an all-equal cohort to the range floor', () => {
    expect(normalizeScores([5, 5, 5], 'min_max')).toEqual([0, 0, 0]);
  });

  it('collapses a single-member cohort to the range floor', () => {
    expect(normalizeScores([42], 'min_max')).toEqual([0]);
  });

  it('returns an empty array for an empty cohort', () => {
    expect(normalizeScores([], 'min_max')).toEqual([]);
  });

  it('honors a custom target range', () => {
    expect(normalizeScores([0, 10], 'min_max', { min: 0, max: 1 })).toEqual([0, 1]);
  });
});

describe('normalizeScores — from_unit_interval', () => {
  it('rescales [0, 1] linearly onto 0–100 (×100) without re-relativizing', () => {
    expect(normalizeScores([0, 0.5, 1], 'from_unit_interval')).toEqual([0, 50, 100]);
  });

  it('does not stretch a compressed cohort to the full range', () => {
    // Unlike min_max, values keep their absolute meaning: 0.4→40, 0.6→60.
    expect(normalizeScores([0.4, 0.6], 'from_unit_interval')).toEqual([40, 60]);
  });

  it('maps a single already-normalized score by its absolute value', () => {
    expect(normalizeScores([1], 'from_unit_interval')).toEqual([100]);
  });

  it('clamps out-of-range inputs to [0, 1]', () => {
    expect(normalizeScores([-0.2, 1.2], 'from_unit_interval')).toEqual([0, 100]);
  });
});

describe('getNormalizationStrategy', () => {
  it('returns a registered strategy', () => {
    expect(getNormalizationStrategy('min_max').normalize([0, 10], SCORE_RANGE)).toEqual([0, 100]);
  });

  it('throws for an unknown method', () => {
    expect(() => getNormalizationStrategy('bogus' as never)).toThrow('Unknown normalization method: bogus');
  });
});
