import type { AlgorithmNormalizationMethod } from '@reputo/reputation-algorithms';

import { CUSTOM_SCORE_TARGET_RANGE } from '../../../../../shared/constants/index.js';
import { EncryptedCustomScoreError } from '../../../../../shared/errors/index.js';
import type { ChildNormalization, EncryptedCustomScoreChild } from './types.js';

/**
 * Phase 1 boundary: turns one child's normalization inputs into an affine map
 * onto the target range, without touching weights or aggregation. A strategy
 * only describes the map; the CKKS executor applies it homomorphically.
 */
export interface EncryptedNormalizationStrategy {
  readonly method: AlgorithmNormalizationMethod;
  buildChildNormalization(child: EncryptedCustomScoreChild): ChildNormalization;
}

/**
 * Observed min–max: `normalized(x) = 100 * (x - min) / (max - min)` over the
 * child's accepted native cohort, expressed as `factor * (x - shift)`. The
 * observed minimum maps to 0 and the maximum to 100; configured source bounds
 * and clamping are unsupported by design. Equal observed bounds mean every
 * accepted score — including native zeros — equals that bound, so the child
 * normalizes to a constant zero.
 */
const observedMinMaxStrategy: EncryptedNormalizationStrategy = {
  method: 'observed_min_max',
  buildChildNormalization(child) {
    const { observation } = child;
    if (observation.method !== 'observed_min_max') {
      throw new EncryptedCustomScoreError(
        `Child "${child.key}" carries a "${observation.method}" observation for the observed_min_max strategy`,
        'INVALID_NORMALIZATION_INPUT',
        { childKey: child.key, observationMethod: observation.method },
      );
    }

    const { min, max } = observation;
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      throw new EncryptedCustomScoreError(
        `Child "${child.key}" has non-finite observed bounds`,
        'INVALID_NORMALIZATION_INPUT',
        { childKey: child.key },
      );
    }
    if (min > max) {
      throw new EncryptedCustomScoreError(
        `Child "${child.key}" has observed minimum greater than its maximum`,
        'INVALID_NORMALIZATION_INPUT',
        { childKey: child.key },
      );
    }

    if (min === max) {
      return { kind: 'constant_zero' };
    }

    const factor = (CUSTOM_SCORE_TARGET_RANGE.max - CUSTOM_SCORE_TARGET_RANGE.min) / (max - min);
    if (!Number.isFinite(factor)) {
      throw new EncryptedCustomScoreError(
        `Child "${child.key}" has an observed span too small to normalize at double precision`,
        'CAPACITY_EXCEEDED',
        { childKey: child.key },
      );
    }

    return { kind: 'affine', factor, shift: min };
  },
};

const STRATEGIES: Readonly<Record<AlgorithmNormalizationMethod, EncryptedNormalizationStrategy>> = {
  observed_min_max: observedMinMaxStrategy,
};

/** Resolves the strategy for a runtime method value; unknown methods fail clearly. */
export function resolveNormalizationStrategy(method: string): EncryptedNormalizationStrategy {
  const strategy = (STRATEGIES as Record<string, EncryptedNormalizationStrategy | undefined>)[method];
  if (!strategy) {
    throw new EncryptedCustomScoreError(
      `Unsupported normalization method "${method}" for encrypted evaluation`,
      'UNSUPPORTED_NORMALIZATION_METHOD',
      { method },
    );
  }
  return strategy;
}
