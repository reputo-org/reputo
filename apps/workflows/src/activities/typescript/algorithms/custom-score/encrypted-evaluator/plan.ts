import { EncryptedCustomScoreError } from '../../../../../shared/errors/index.js';
import { resolveNormalizationStrategy } from './strategies.js';
import type {
  ChildContribution,
  ChildNormalization,
  ChildWeighting,
  CreateEncryptedCustomScoreEvaluatorInput,
  EncryptedCustomScoreChild,
  EncryptedEvaluationPlan,
  ZeroFallback,
} from './types.js';

function validateChildren(children: EncryptedCustomScoreChild[]): void {
  if (children.length === 0) {
    throw new EncryptedCustomScoreError('At least one selected child is required', 'INVALID_CHILDREN');
  }
  const seen = new Set<string>();
  for (const child of children) {
    if (typeof child.key !== 'string' || child.key.trim() === '') {
      throw new EncryptedCustomScoreError('A selected child has an empty key', 'INVALID_CHILDREN');
    }
    if (seen.has(child.key)) {
      throw new EncryptedCustomScoreError(`Duplicate selected child "${child.key}"`, 'INVALID_CHILDREN', {
        childKey: child.key,
      });
    }
    seen.add(child.key);
  }
}

/** Phase 1: one affine (or constant-zero) normalization per child, via the active strategy. */
export function buildNormalizationPlan(method: string, children: EncryptedCustomScoreChild[]): ChildNormalization[] {
  validateChildren(children);
  const strategy = resolveNormalizationStrategy(method);
  return children.map((child) => strategy.buildChildNormalization(child));
}

/**
 * Phase 2: applies each configured weight to its normalized child. Every
 * configured weight must be finite and greater than zero — a zero or negative
 * weight is rejected outright, never silently treated as "no contribution". A
 * constant-zero normalization (equal observed bounds) still makes the child's
 * contribution zero without removing its weight from the later denominator.
 */
export function applyChildWeights(
  children: EncryptedCustomScoreChild[],
  normalizations: ChildNormalization[],
): ChildWeighting[] {
  return children.map((child, index) => {
    if (typeof child.weight !== 'number' || !Number.isFinite(child.weight) || child.weight <= 0) {
      throw new EncryptedCustomScoreError(
        `Child "${child.key}" has an invalid weight: weights must be finite and greater than zero`,
        'INVALID_WEIGHT',
        { childKey: child.key },
      );
    }

    const normalization = normalizations[index];
    if (normalization.kind === 'constant_zero') {
      return { kind: 'zero' };
    }
    return {
      kind: 'affine',
      factor: normalization.factor * child.weight,
      shift: normalization.shift,
    };
  });
}

/**
 * Phase 3: aggregates weighted children into per-child contributions of one
 * final score. The denominator is the sum of every configured weight —
 * equal-bounds children included — and at least one weight must be greater
 * than zero. Phase 2 already rejects a non-positive individual weight; the
 * sum is still checked here because this phase is independently callable.
 */
export function buildAggregationPlan(
  children: EncryptedCustomScoreChild[],
  weightings: ChildWeighting[],
): { totalWeight: number; contributions: ChildContribution[] } {
  const totalWeight = children.reduce((sum, child) => sum + child.weight, 0);
  if (!Number.isFinite(totalWeight)) {
    throw new EncryptedCustomScoreError('The total configured child weight must be finite', 'INVALID_WEIGHT');
  }
  if (totalWeight <= 0) {
    throw new EncryptedCustomScoreError(
      'At least one configured child weight must be greater than zero',
      'ALL_ZERO_WEIGHTS',
    );
  }

  const contributions = weightings.map((weighting, index): ChildContribution => {
    if (weighting.kind === 'zero') {
      return { kind: 'zero' };
    }
    const coefficient = weighting.factor / totalWeight;
    if (!Number.isFinite(coefficient) || coefficient === 0) {
      throw new EncryptedCustomScoreError(
        `Child "${children[index].key}" has a contribution coefficient outside double precision`,
        'CAPACITY_EXCEEDED',
        { childKey: children[index].key },
      );
    }
    return { kind: 'affine', coefficient, shift: weighting.shift };
  });

  return { totalWeight, contributions };
}

/**
 * The first equal-bounds child, whose every accepted score — and therefore
 * every complete user's ciphertext for it — is known to encrypt the bound
 * value. When every contribution is zero, at least one positively weighted
 * child must be equal-bounds, so a fallback always exists in that case.
 */
function selectZeroFallback(
  children: EncryptedCustomScoreChild[],
  normalizations: ChildNormalization[],
): ZeroFallback | null {
  const index = normalizations.findIndex((normalization) => normalization.kind === 'constant_zero');
  if (index === -1) {
    return null;
  }
  const observation = children[index].observation;
  return { childKey: children[index].key, knownValue: observation.min };
}

/** Composes the three phases into one ciphertext-independent evaluation plan. */
export function buildEncryptedEvaluationPlan(input: CreateEncryptedCustomScoreEvaluatorInput): EncryptedEvaluationPlan {
  const { children } = input;
  const normalizations = buildNormalizationPlan(input.method, children);
  const strategy = resolveNormalizationStrategy(input.method);
  const weightings = applyChildWeights(children, normalizations);
  const { totalWeight, contributions } = buildAggregationPlan(children, weightings);
  const zeroFallback = selectZeroFallback(children, normalizations);

  const everyContributionZero = contributions.every((contribution) => contribution.kind === 'zero');
  if (everyContributionZero && zeroFallback === null) {
    throw new EncryptedCustomScoreError(
      'Every contribution is zero but no equal-bounds child exists to derive an encrypted zero from',
      'EVALUATION_FAILED',
    );
  }

  return {
    method: strategy.method,
    totalWeight,
    children: children.map((child, index) => ({
      key: child.key,
      weight: child.weight,
      observation: child.observation,
      contribution: contributions[index],
    })),
    zeroFallback,
  };
}
