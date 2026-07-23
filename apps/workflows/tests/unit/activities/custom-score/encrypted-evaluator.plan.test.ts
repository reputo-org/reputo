import { describe, expect, it } from 'vitest';

import {
  applyChildWeights,
  buildAggregationPlan,
  buildEncryptedEvaluationPlan,
  buildNormalizationPlan,
  type ChildNormalization,
  type EncryptedCustomScoreChild,
  resolveNormalizationStrategy,
} from '../../../../src/activities/typescript/algorithms/custom-score/encrypted-evaluator/index.js';
import { EncryptedCustomScoreError, type EncryptedCustomScoreErrorCode } from '../../../../src/shared/errors/index.js';

function child(key: string, weight: number, min: number, max: number): EncryptedCustomScoreChild {
  return { key, weight, observation: { method: 'observed_min_max', min, max } };
}

function expectPlanError(fn: () => unknown, code: EncryptedCustomScoreErrorCode): EncryptedCustomScoreError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(EncryptedCustomScoreError);
    const typed = error as EncryptedCustomScoreError;
    expect(typed.evaluationCode).toBe(code);
    return typed;
  }
  throw new Error(`Expected an EncryptedCustomScoreError with code ${code}`);
}

describe('normalization strategy boundary (phase 1)', () => {
  it('resolves the observed_min_max strategy', () => {
    expect(resolveNormalizationStrategy('observed_min_max').method).toBe('observed_min_max');
  });

  it('rejects an unknown normalization method', () => {
    expectPlanError(() => resolveNormalizationStrategy('z_score'), 'UNSUPPORTED_NORMALIZATION_METHOD');
  });

  it('builds the affine map factor * (x - shift) from observed bounds', () => {
    const [normalization] = buildNormalizationPlan('observed_min_max', [child('voting_engagement', 1, -20, 30)]);
    expect(normalization).toEqual({ kind: 'affine', factor: 2, shift: -20 });
  });

  it('matches the design formula a * x + b at cohort minimum, midpoint, and maximum', () => {
    const min = -20;
    const max = 30;
    const [normalization] = buildNormalizationPlan('observed_min_max', [child('voting_engagement', 1, min, max)]);
    if (normalization.kind !== 'affine') {
      throw new Error('expected an affine normalization');
    }
    const a = 100 / (max - min);
    const b = -min * a;
    for (const raw of [min, (min + max) / 2, max]) {
      expect(normalization.factor * (raw - normalization.shift)).toBeCloseTo(a * raw + b, 10);
    }
    expect(normalization.factor * (min - normalization.shift)).toBeCloseTo(0, 10);
    expect(normalization.factor * (max - normalization.shift)).toBeCloseTo(100, 10);
  });

  it('normalizes equal observed bounds to a constant zero', () => {
    const [normalization] = buildNormalizationPlan('observed_min_max', [child('voting_engagement', 1, 7, 7)]);
    expect(normalization).toEqual({ kind: 'constant_zero' });
  });

  it('rejects non-finite observed bounds', () => {
    expectPlanError(
      () => buildNormalizationPlan('observed_min_max', [child('voting_engagement', 1, Number.NaN, 5)]),
      'INVALID_NORMALIZATION_INPUT',
    );
    expectPlanError(
      () => buildNormalizationPlan('observed_min_max', [child('voting_engagement', 1, 0, Number.POSITIVE_INFINITY)]),
      'INVALID_NORMALIZATION_INPUT',
    );
  });

  it('rejects an observed minimum above the maximum', () => {
    expectPlanError(
      () => buildNormalizationPlan('observed_min_max', [child('voting_engagement', 1, 10, 5)]),
      'INVALID_NORMALIZATION_INPUT',
    );
  });

  it('rejects an observation collected for another method', () => {
    const mismatched = {
      key: 'voting_engagement',
      weight: 1,
      observation: { method: 'z_score', min: 0, max: 1 },
    } as unknown as EncryptedCustomScoreChild;
    expectPlanError(() => buildNormalizationPlan('observed_min_max', [mismatched]), 'INVALID_NORMALIZATION_INPUT');
  });

  it('rejects an empty child selection', () => {
    expectPlanError(() => buildNormalizationPlan('observed_min_max', []), 'INVALID_CHILDREN');
  });

  it('rejects duplicate child keys', () => {
    expectPlanError(
      () =>
        buildNormalizationPlan('observed_min_max', [
          child('voting_engagement', 1, 0, 10),
          child('voting_engagement', 2, 0, 10),
        ]),
      'INVALID_CHILDREN',
    );
  });
});

describe('weighting (phase 2)', () => {
  const affine: ChildNormalization = { kind: 'affine', factor: 2, shift: -20 };

  it('folds the configured weight into the normalization factor', () => {
    const [weighting] = applyChildWeights([child('voting_engagement', 3, -20, 30)], [affine]);
    expect(weighting).toEqual({ kind: 'affine', factor: 6, shift: -20 });
  });

  it('keeps a constant-zero normalization zero under a positive weight', () => {
    const [weighting] = applyChildWeights([child('voting_engagement', 5, 7, 7)], [{ kind: 'constant_zero' }]);
    expect(weighting).toEqual({ kind: 'zero' });
  });

  it('rejects zero, negative, and non-finite weights', () => {
    for (const weight of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectPlanError(
        () => applyChildWeights([child('voting_engagement', weight, -20, 30)], [affine]),
        'INVALID_WEIGHT',
      );
    }
  });
});

describe('aggregation (phase 3)', () => {
  it('divides by the sum of every configured weight, equal-bounds children included', () => {
    const children = [
      child('voting_engagement', 2, -20, 30),
      child('contribution_score', 1, 10, 10),
      child('token_value_over_time', 3, 0, 50),
    ];
    const { totalWeight, contributions } = buildAggregationPlan(children, [
      { kind: 'affine', factor: 4, shift: -20 },
      { kind: 'zero' },
      { kind: 'affine', factor: 6, shift: 0 },
    ]);
    expect(totalWeight).toBe(6);
    expect(contributions).toEqual([
      { kind: 'affine', coefficient: 4 / 6, shift: -20 },
      { kind: 'zero' },
      { kind: 'affine', coefficient: 1, shift: 0 },
    ]);
  });

  it('keeps an equal-bounds child weight in the denominator', () => {
    const children = [child('voting_engagement', 1, 7, 7), child('contribution_score', 1, 0, 100)];
    const { totalWeight, contributions } = buildAggregationPlan(children, [
      { kind: 'zero' },
      { kind: 'affine', factor: 1, shift: 0 },
    ]);
    expect(totalWeight).toBe(2);
    expect(contributions[1]).toEqual({ kind: 'affine', coefficient: 0.5, shift: 0 });
  });

  it('rejects an all-zero weight configuration', () => {
    expectPlanError(
      () =>
        buildAggregationPlan(
          [child('voting_engagement', 0, 0, 10), child('contribution_score', 0, 0, 10)],
          [{ kind: 'zero' }, { kind: 'zero' }],
        ),
      'ALL_ZERO_WEIGHTS',
    );
  });

  it('rejects a non-finite total weight', () => {
    expectPlanError(
      () =>
        buildAggregationPlan(
          [child('voting_engagement', 1e308, 0, 10), child('contribution_score', 1e308, 0, 10)],
          [
            { kind: 'affine', factor: 1e308, shift: 0 },
            { kind: 'affine', factor: 1e308, shift: 0 },
          ],
        ),
      'INVALID_WEIGHT',
    );
  });
});

describe('composed evaluation plan', () => {
  it('produces per-child coefficients equal to a_i * w_i / totalWeight', () => {
    const children = [child('voting_engagement', 2, 0, 100), child('contribution_score', 3, -20, 30)];
    const plan = buildEncryptedEvaluationPlan({ method: 'observed_min_max', children });

    expect(plan.method).toBe('observed_min_max');
    expect(plan.totalWeight).toBe(5);
    const [first, second] = plan.children;
    expect(first.contribution).toEqual({ kind: 'affine', coefficient: (100 / 100) * (2 / 5), shift: 0 });
    expect(second.contribution).toEqual({ kind: 'affine', coefficient: (100 / 50) * (3 / 5), shift: -20 });
  });

  it('selects the first equal-bounds child as the encrypted-zero fallback', () => {
    const plan = buildEncryptedEvaluationPlan({
      method: 'observed_min_max',
      children: [
        child('voting_engagement', 1, 0, 100),
        child('contribution_score', 1, -3, -3),
        child('token_value_over_time', 1, 5, 5),
      ],
    });
    expect(plan.zeroFallback).toEqual({ childKey: 'contribution_score', knownValue: -3 });
  });

  it('has no fallback when every child has spread', () => {
    const plan = buildEncryptedEvaluationPlan({
      method: 'observed_min_max',
      children: [child('voting_engagement', 1, 0, 100)],
    });
    expect(plan.zeroFallback).toBeNull();
  });

  it('supports an all-zero plan when every child has equal bounds', () => {
    const plan = buildEncryptedEvaluationPlan({
      method: 'observed_min_max',
      children: [child('voting_engagement', 1, 7, 7), child('contribution_score', 2, 3, 3)],
    });
    expect(plan.children.every((planned) => planned.contribution.kind === 'zero')).toBe(true);
    expect(plan.zeroFallback).toEqual({ childKey: 'voting_engagement', knownValue: 7 });
  });

  it('rejects an unknown method before any evaluation', () => {
    expectPlanError(
      () => buildEncryptedEvaluationPlan({ method: 'configured_bounds', children: [child('a', 1, 0, 1)] }),
      'UNSUPPORTED_NORMALIZATION_METHOD',
    );
  });
});
