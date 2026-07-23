import type { SealMetadata } from '@reputo/deep-id-api';
import type { AlgorithmNormalizationMethod } from '@reputo/reputation-algorithms';

import type { NormalizationObservation } from '../../../../../shared/types/index.js';

/** One selected child of the combined preset, as the evaluator consumes it. */
export interface EncryptedCustomScoreChild {
  /** Child algorithm key, unique within one evaluator (e.g. `voting_engagement`). */
  key: string;
  /** Configured child weight; must be finite and greater than zero. */
  weight: number;
  /** Per-child inputs collected for the active normalization method. */
  observation: NormalizationObservation;
}

export interface CreateEncryptedCustomScoreEvaluatorInput {
  /**
   * Active normalization method from the frozen definition. Runtime data, so
   * typed as `string`: an unknown method fails with a typed error instead of
   * being silently coerced.
   */
  method: string;
  children: EncryptedCustomScoreChild[];
}

/** One allegedly complete unified user handed across the evaluator boundary. */
export interface EncryptedCustomScoreUser {
  /** Unified `did:sub` identifier; used in error context, never with score data. */
  did: string;
  /** `id` of the SEAL metadata document the user's ciphertexts reference. */
  keyId: string;
  /**
   * Serialized child ciphertexts by child algorithm key. Complete means
   * exactly one non-empty ciphertext per configured child — including
   * ciphertexts DeepID created from native plaintext zeros.
   */
  ciphertexts: Record<string, string>;
}

/** One evaluated user: the serialized `custom_score_encr` ciphertext and its key. */
export interface EncryptedCustomScoreResult {
  did: string;
  /** Echoed metadata key id for the final `POST /v1/clients/scores` entry. */
  keyId: string;
  /** Serialized CKKS ciphertext of the aggregated score; no secret material. */
  ciphertext: string;
}

export interface EncryptedCustomScoreEvaluatorStats {
  registeredKeys: number;
  /** SEAL/WASM handles created by this evaluator and not yet released. */
  liveHandles: number;
}

/**
 * Homomorphic `custom_score` evaluator for one activity invocation. Holds a
 * per-key-ID cache of SEAL evaluation contexts; `dispose()` releases every
 * WASM object and must be called when the activity finishes, on success and
 * on error. The instance only ever evaluates: it can never encrypt, decrypt,
 * generate keys, or hold secret material.
 */
export interface EncryptedCustomScoreEvaluator {
  /**
   * Validates public SEAL metadata, builds its evaluation context, and caches
   * it under `metadata.id`. Registering an already-registered id is a no-op.
   */
  registerSealMetadata(metadata: SealMetadata): void;
  hasKey(keyId: string): boolean;
  /** Evaluates one complete user into one serialized `custom_score_encr` ciphertext. */
  evaluateUser(user: EncryptedCustomScoreUser): EncryptedCustomScoreResult;
  /** Evaluates one bounded page of users; fails fast on the first fatal user. */
  evaluateBatch(users: readonly EncryptedCustomScoreUser[]): EncryptedCustomScoreResult[];
  stats(): EncryptedCustomScoreEvaluatorStats;
  dispose(): void;
}

/**
 * Phase 1 output for one child. `affine` maps a raw score `x` onto the target
 * range as `factor * (x - shift)` — algebraically identical to the design's
 * `a * x + b` with `a = factor`, `b = -shift * factor`, but evaluated in the
 * shifted form so homomorphic intermediates stay near the cohort span instead
 * of `|b|`, which can exceed CKKS capacity for far-from-zero cohorts.
 */
export type ChildNormalization = { kind: 'affine'; factor: number; shift: number } | { kind: 'constant_zero' };

/** Phase 2 output for one child: the weight folded into the normalization. */
export type ChildWeighting = { kind: 'affine'; factor: number; shift: number } | { kind: 'zero' };

/**
 * Phase 3 output for one child: `coefficient = weighted factor / total weight`.
 * A user's score is `sum(coefficient_i * (x_i - shift_i))` over affine children.
 */
export type ChildContribution = { kind: 'affine'; coefficient: number; shift: number } | { kind: 'zero' };

export interface PlannedChild {
  key: string;
  weight: number;
  observation: NormalizationObservation;
  contribution: ChildContribution;
}

/**
 * How an all-zero user result is derived without an encryptor: an equal-bounds
 * child's ciphertext is known to encrypt `knownValue`, so subtracting that
 * plaintext yields a normal, non-transparent encryption of zero.
 */
export interface ZeroFallback {
  childKey: string;
  knownValue: number;
}

/** The composed, ciphertext-independent evaluation plan for one preset. */
export interface EncryptedEvaluationPlan {
  method: AlgorithmNormalizationMethod;
  /** Sum of every configured child weight (every configured weight is greater than zero). */
  totalWeight: number;
  children: PlannedChild[];
  /** Present whenever an equal-bounds child exists; required when every contribution is zero. */
  zeroFallback: ZeroFallback | null;
}
