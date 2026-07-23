import type { SealMetadata } from '@reputo/deep-id-api';
import type { Ciphertext, ParmsIdType, Plaintext } from 'node-seal';

import { CUSTOM_SCORE_EVALUATION_BATCH_LIMIT } from '../../../../../shared/constants/index.js';
import { EncryptedCustomScoreError } from '../../../../../shared/errors/index.js';
import { buildEncryptedEvaluationPlan } from './plan.js';
import { buildSealKeyContext, SCALE_RELATIVE_TOLERANCE, type SealKeyContext } from './seal-context.js';
import {
  createSealHandleLedger,
  describeSealError,
  getSealRuntime,
  SealHandleScope,
  type SealRuntime,
} from './seal-runtime.js';
import type {
  ChildContribution,
  CreateEncryptedCustomScoreEvaluatorInput,
  EncryptedCustomScoreEvaluator,
  EncryptedCustomScoreResult,
  EncryptedCustomScoreUser,
  EncryptedEvaluationPlan,
  PlannedChild,
  ZeroFallback,
} from './types.js';

type AffineChild = PlannedChild & { contribution: Extract<ChildContribution, { kind: 'affine' }> };

interface RegisteredKey {
  key: SealKeyContext;
  scope: SealHandleScope;
}

function relativeDifference(a: number, b: number): number {
  const magnitude = Math.max(Math.abs(a), Math.abs(b));
  return magnitude === 0 ? 0 : Math.abs(a - b) / magnitude;
}

/**
 * Creates one homomorphic `custom_score` evaluator for one activity
 * invocation. The instance validates and caches SEAL evaluation contexts by
 * metadata key id, evaluates complete users into serialized
 * `custom_score_encr` ciphertexts, and releases every WASM object on
 * `dispose()`. It performs evaluation only — no encryptor, decryptor, secret
 * key, or key generator is ever created here — and it never logs or persists
 * plaintext scores or ciphertext bodies.
 *
 * Homomorphically, each user's score is computed at multiplicative depth one:
 * the three planning phases fold into one plaintext coefficient and shift per
 * child, so a child costs a plaintext subtraction, one ciphertext-plaintext
 * multiplication, and one rescale before the ciphertext additions. This is
 * required by DeepID-style modulus chains with a single rescale level.
 */
export async function createEncryptedCustomScoreEvaluator(
  input: CreateEncryptedCustomScoreEvaluatorInput,
): Promise<EncryptedCustomScoreEvaluator> {
  const plan = buildEncryptedEvaluationPlan(input);
  const seal = await getSealRuntime();

  const ledger = createSealHandleLedger();
  const registeredKeys = new Map<string, RegisteredKey>();
  let disposed = false;

  const ensureUsable = (): void => {
    if (disposed) {
      throw new EncryptedCustomScoreError('The encrypted evaluator was already disposed', 'EVALUATOR_DISPOSED');
    }
  };

  const registerSealMetadata = (metadata: SealMetadata): void => {
    ensureUsable();
    if (registeredKeys.has(metadata.id)) {
      return;
    }
    const scope = new SealHandleScope(ledger);
    try {
      const key = buildSealKeyContext(seal, metadata, plan, scope);
      registeredKeys.set(metadata.id, { key, scope });
    } catch (error) {
      scope.dispose();
      throw error;
    }
  };

  const evaluateUser = (user: EncryptedCustomScoreUser): EncryptedCustomScoreResult => {
    ensureUsable();

    const registered = registeredKeys.get(user.keyId);
    if (!registered) {
      throw new EncryptedCustomScoreError(
        `User "${user.did}" references metadata key "${user.keyId}", which is not registered`,
        'UNREGISTERED_KEY',
        { did: user.did, keyId: user.keyId },
      );
    }
    const { key } = registered;

    validateCiphertextSet(plan, user);

    const scope = new SealHandleScope(ledger);
    try {
      const ciphertexts = deserializeCiphertexts(seal, scope, key, plan, user);

      const activeChildren = plan.children.filter(
        (child): child is AffineChild => child.contribution.kind === 'affine',
      );
      const result =
        activeChildren.length > 0
          ? evaluateAffineChildren(seal, scope, key, user, activeChildren, ciphertexts)
          : deriveEncryptedZero(seal, scope, key, user, plan.zeroFallback, ciphertexts);

      if (result.isTransparent()) {
        throw new EncryptedCustomScoreError(
          `Evaluation for user "${user.did}" produced a transparent ciphertext`,
          'EVALUATION_FAILED',
          { did: user.did },
        );
      }

      return { did: user.did, keyId: user.keyId, ciphertext: result.saveToBase64(seal.ComprModeType.zstd) };
    } catch (error) {
      if (error instanceof EncryptedCustomScoreError) {
        throw error;
      }
      throw new EncryptedCustomScoreError(
        `Encrypted evaluation failed for user "${user.did}": ${describeSealError(error)}`,
        'EVALUATION_FAILED',
        { did: user.did, keyId: user.keyId },
      );
    } finally {
      scope.dispose();
    }
  };

  const evaluateBatch = (users: readonly EncryptedCustomScoreUser[]): EncryptedCustomScoreResult[] => {
    ensureUsable();
    if (users.length > CUSTOM_SCORE_EVALUATION_BATCH_LIMIT) {
      throw new EncryptedCustomScoreError(
        `Evaluation batch of ${users.length} users exceeds the limit of ${CUSTOM_SCORE_EVALUATION_BATCH_LIMIT}`,
        'BATCH_LIMIT_EXCEEDED',
        { batchSize: users.length, limit: CUSTOM_SCORE_EVALUATION_BATCH_LIMIT },
      );
    }
    return users.map((user) => evaluateUser(user));
  };

  return {
    registerSealMetadata,
    hasKey: (keyId) => registeredKeys.has(keyId),
    evaluateUser,
    evaluateBatch,
    stats: () => ({ registeredKeys: registeredKeys.size, liveHandles: ledger.created - ledger.released }),
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const registered of registeredKeys.values()) {
        registered.scope.dispose();
      }
      registeredKeys.clear();
    },
  };
}

/** The user's ciphertext set must be exactly the configured child set, all non-empty. */
function validateCiphertextSet(plan: EncryptedEvaluationPlan, user: EncryptedCustomScoreUser): void {
  const configured = new Set(plan.children.map((child) => child.key));
  for (const childKey of Object.keys(user.ciphertexts)) {
    if (!configured.has(childKey)) {
      throw new EncryptedCustomScoreError(
        `User "${user.did}" carries a ciphertext for unselected child "${childKey}"`,
        'INCOMPLETE_CIPHERTEXT_SET',
        { did: user.did, childKey },
      );
    }
  }
  for (const child of plan.children) {
    const serialized = user.ciphertexts[child.key];
    if (typeof serialized !== 'string' || serialized === '') {
      throw new EncryptedCustomScoreError(
        `User "${user.did}" is missing the selected ciphertext for child "${child.key}"`,
        'INCOMPLETE_CIPHERTEXT_SET',
        { did: user.did, childKey: child.key },
      );
    }
  }
}

/**
 * Deserializes every selected ciphertext under the user's key context —
 * zero-contribution children included, so corruption or foreign parameters
 * fail even when a value would go unused. Deserialization validates structure
 * and parameters; encryption-key identity is DeepID's guarantee, checked via
 * the referenced metadata key id.
 */
function deserializeCiphertexts(
  seal: SealRuntime,
  scope: SealHandleScope,
  key: SealKeyContext,
  plan: EncryptedEvaluationPlan,
  user: EncryptedCustomScoreUser,
): Record<string, Ciphertext> {
  const ciphertexts: Record<string, Ciphertext> = {};
  for (const child of plan.children) {
    const ciphertext = scope.track(new seal.Ciphertext());
    try {
      ciphertext.loadFromBase64(key.context, user.ciphertexts[child.key]);
    } catch (error) {
      throw new EncryptedCustomScoreError(
        `Ciphertext of child "${child.key}" for user "${user.did}" cannot be used under key "${key.keyId}": ${describeSealError(error)}`,
        'INCOMPATIBLE_CIPHERTEXT',
        { did: user.did, childKey: child.key, keyId: key.keyId },
      );
    }
    if (relativeDifference(ciphertext.scale(), key.scale) > SCALE_RELATIVE_TOLERANCE) {
      throw new EncryptedCustomScoreError(
        `Ciphertext of child "${child.key}" for user "${user.did}" is not at the metadata scale`,
        'INCOMPATIBLE_CIPHERTEXT',
        { did: user.did, childKey: child.key, keyId: key.keyId },
      );
    }
    ciphertexts[child.key] = ciphertext;
  }
  return ciphertexts;
}

/**
 * Encodes one scalar into every CKKS slot. The constant fill concentrates the
 * scaled value into a single polynomial coefficient, so encoding quantization
 * stays relative to the value itself; a one-slot encoding would spread it
 * across all coefficients and amplify rounding error by orders of magnitude.
 */
function encodeScalar(
  seal: SealRuntime,
  scope: SealHandleScope,
  key: SealKeyContext,
  value: number,
  scale: number,
): Plaintext {
  const plain = scope.track(new seal.Plaintext());
  const values = new Float64Array(key.slotCount);
  values.fill(value);
  key.encoder.encode(values, scale, plain);
  return plain;
}

/**
 * Aligns the contributing ciphertexts onto their deepest common modulus level
 * and returns that level's parms id. One level must remain below it so every
 * product can rescale.
 */
function alignToCommonLevel(
  scope: SealHandleScope,
  key: SealKeyContext,
  user: EncryptedCustomScoreUser,
  ciphertexts: Ciphertext[],
): ParmsIdType {
  let minChainIndex = Number.POSITIVE_INFINITY;
  let target: ParmsIdType | undefined;
  for (const ciphertext of ciphertexts) {
    const parmsId = scope.track(ciphertext.parmsId());
    const contextData = scope.track(key.context.getContextData(parmsId));
    const chainIndex = contextData.chainIndex();
    scope.release(contextData);
    if (chainIndex < minChainIndex) {
      minChainIndex = chainIndex;
      if (target) {
        scope.release(target);
      }
      target = parmsId;
    } else {
      scope.release(parmsId);
    }
  }

  if (target === undefined || minChainIndex < 1) {
    throw new EncryptedCustomScoreError(
      `Ciphertexts for user "${user.did}" leave no modulus level for rescaling after multiplication`,
      'IMPOSSIBLE_ALIGNMENT',
      { did: user.did, keyId: key.keyId },
    );
  }

  for (const ciphertext of ciphertexts) {
    key.evaluator.cipherModSwitchToInplace(ciphertext, target);
  }
  return target;
}

/**
 * The normal path: for each contributing child, subtract the observed shift,
 * multiply by the folded plaintext coefficient, rescale, then sum. All inputs
 * went through identical operations from one aligned level, so scales match
 * exactly; residual drift within tolerance is canonicalized, anything larger
 * is an alignment failure.
 */
function evaluateAffineChildren(
  seal: SealRuntime,
  scope: SealHandleScope,
  key: SealKeyContext,
  user: EncryptedCustomScoreUser,
  activeChildren: AffineChild[],
  ciphertexts: Record<string, Ciphertext>,
): Ciphertext {
  const activeCiphertexts = activeChildren.map((child) => ciphertexts[child.key]);
  const workingParmsId = alignToCommonLevel(scope, key, user, activeCiphertexts);

  let accumulator: Ciphertext | undefined;
  let canonicalScale: number | undefined;

  for (const child of activeChildren) {
    const ciphertext = ciphertexts[child.key];
    const { coefficient, shift } = child.contribution;

    if (shift !== 0) {
      const shiftPlain = encodeScalar(seal, scope, key, shift, ciphertext.scale());
      // A shift below encoding granularity is a numeric no-op, not an error.
      if (!shiftPlain.isZero()) {
        key.evaluator.plainModSwitchToInplace(shiftPlain, workingParmsId);
        key.evaluator.subPlainInplace(ciphertext, shiftPlain);
      }
      scope.release(shiftPlain);
    }

    const coefficientPlain = encodeScalar(seal, scope, key, coefficient, key.scale);
    if (coefficientPlain.isZero()) {
      throw new EncryptedCustomScoreError(
        `Contribution coefficient of child "${child.key}" underflows the CKKS scale of key "${key.keyId}"`,
        'CAPACITY_EXCEEDED',
        { did: user.did, childKey: child.key, keyId: key.keyId },
      );
    }
    key.evaluator.plainModSwitchToInplace(coefficientPlain, workingParmsId);
    key.evaluator.multiplyPlainInplace(ciphertext, coefficientPlain);
    scope.release(coefficientPlain);
    key.evaluator.rescaleToNextInplace(ciphertext);

    if (accumulator === undefined || canonicalScale === undefined) {
      accumulator = ciphertext;
      canonicalScale = ciphertext.scale();
      continue;
    }
    if (relativeDifference(ciphertext.scale(), canonicalScale) > SCALE_RELATIVE_TOLERANCE) {
      throw new EncryptedCustomScoreError(
        `Rescaled contributions for user "${user.did}" have unalignable scales`,
        'IMPOSSIBLE_ALIGNMENT',
        { did: user.did, keyId: key.keyId },
      );
    }
    ciphertext.setScale(canonicalScale);
    key.evaluator.addInplace(accumulator, ciphertext);
  }

  if (accumulator === undefined) {
    throw new EncryptedCustomScoreError(`No contribution was accumulated for user "${user.did}"`, 'EVALUATION_FAILED', {
      did: user.did,
    });
  }
  return accumulator;
}

/**
 * The all-zero path: every contribution is zero, so the score is zero, but
 * Reputo must not encrypt anything. An equal-bounds child's ciphertext is a
 * normal DeepID encryption of its known bound value; subtracting that value
 * as a plaintext yields a non-transparent encryption of (approximately) zero.
 * When the known value itself encodes to zero, the child's ciphertext already
 * encrypts zero and is used as-is.
 */
function deriveEncryptedZero(
  seal: SealRuntime,
  scope: SealHandleScope,
  key: SealKeyContext,
  user: EncryptedCustomScoreUser,
  fallback: ZeroFallback | null,
  ciphertexts: Record<string, Ciphertext>,
): Ciphertext {
  const ciphertext = fallback === null ? undefined : ciphertexts[fallback.childKey];
  if (fallback === null || ciphertext === undefined) {
    throw new EncryptedCustomScoreError(
      `No equal-bounds child ciphertext is available to derive an encrypted zero for user "${user.did}"`,
      'EVALUATION_FAILED',
      { did: user.did },
    );
  }

  const knownPlain = encodeScalar(seal, scope, key, fallback.knownValue, ciphertext.scale());
  if (!knownPlain.isZero()) {
    const parmsId = scope.track(ciphertext.parmsId());
    key.evaluator.plainModSwitchToInplace(knownPlain, parmsId);
    scope.release(parmsId);
    key.evaluator.subPlainInplace(ciphertext, knownPlain);
  }
  scope.release(knownPlain);
  return ciphertext;
}
