import type { SealMetadata } from '@reputo/deep-id-api';
import type { CKKSEncoder, Evaluator, SEALContext, SecLevelType } from 'node-seal';

import { EncryptedCustomScoreError } from '../../../../../shared/errors/index.js';
import { describeSealError, type SealHandleScope, type SealRuntime } from './seal-runtime.js';
import type { EncryptedEvaluationPlan } from './types.js';

/**
 * Headroom subtracted from the raw CKKS capacity when bounding observed score
 * magnitudes: 1 bit because `x - shift` can double the magnitude, plus 4 bits
 * for encoding spread and noise. SEAL wraps oversized values silently, so the
 * evaluator must reject them itself.
 */
const CAPACITY_MARGIN_BITS = 5;

/** Relative tolerance when comparing ciphertext scales against the metadata scale. */
export const SCALE_RELATIVE_TOLERANCE = 2 ** -20;

/** One validated, cached evaluation context for a metadata key. */
export interface SealKeyContext {
  keyId: string;
  scale: number;
  context: SEALContext;
  evaluator: Evaluator;
  encoder: CKKSEncoder;
  /** CKKS slot count (`polyModulusDegree / 2`) of this context's encoder. */
  slotCount: number;
  /** Largest absolute value the parameters can hold at the metadata scale. */
  magnitudeLimit: number;
}

function resolveSecurityLevel(seal: SealRuntime, metadata: SealMetadata): SecLevelType {
  switch (metadata.securityLevel) {
    case 128:
      return seal.SecLevelType.tc128;
    case 192:
      return seal.SecLevelType.tc192;
    case 256:
      return seal.SecLevelType.tc256;
    default:
      throw new EncryptedCustomScoreError(
        `SEAL metadata "${metadata.id}" is incompatible: unsupported security level ${metadata.securityLevel}`,
        'INCOMPATIBLE_METADATA',
        { keyId: metadata.id, securityLevel: metadata.securityLevel },
      );
  }
}

/**
 * Builds and validates one CKKS evaluation context from public SEAL metadata,
 * tracking every WASM handle in the caller's scope. The serialized parameters
 * must parse, agree with every declared metadata field, satisfy the declared
 * security level, and leave one modulus level for rescaling. The plan's
 * observed bounds are checked against the parameters' numeric capacity so
 * oversized cohorts fail typed instead of wrapping silently.
 */
export function buildSealKeyContext(
  seal: SealRuntime,
  metadata: SealMetadata,
  plan: EncryptedEvaluationPlan,
  scope: SealHandleScope,
): SealKeyContext {
  const fail = (reason: string, context?: Record<string, unknown>): never => {
    throw new EncryptedCustomScoreError(
      `SEAL metadata "${metadata.id}" is incompatible: ${reason}`,
      'INCOMPATIBLE_METADATA',
      { keyId: metadata.id, ...context },
    );
  };

  if (!Number.isFinite(metadata.scale) || metadata.scale <= 1) {
    fail('scale must be a finite number greater than 1', { scale: metadata.scale });
  }

  const securityLevel = resolveSecurityLevel(seal, metadata);

  const parms = scope.track(new seal.EncryptionParameters(seal.SchemeType.none));
  try {
    parms.loadFromBase64(metadata.encryptionParameters);
  } catch (error) {
    fail(`encryption parameters cannot be deserialized (${describeSealError(error)})`);
  }

  if (parms.scheme().value !== seal.SchemeType.ckks.value) {
    fail('encryption parameters are not CKKS');
  }
  if (parms.polyModulusDegree() !== metadata.polyModulusDegree) {
    fail('declared polyModulusDegree does not match the encryption parameters', {
      declared: metadata.polyModulusDegree,
      actual: parms.polyModulusDegree(),
    });
  }

  const modulus = scope.track(parms.coeffModulus());
  const actualBitSizes: number[] = [];
  for (let index = 0; index < modulus.size(); index++) {
    const prime = modulus.get(index);
    if (prime) {
      actualBitSizes.push(prime.bitCount());
      prime.delete();
    }
  }
  scope.release(modulus);
  const declared = metadata.coeffModulusBitSizes;
  const bitSizesMatch =
    declared.length === actualBitSizes.length && declared.every((bits, index) => bits === actualBitSizes[index]);
  if (!bitSizesMatch) {
    fail('declared coeffModulusBitSizes do not match the encryption parameters', {
      declared,
      actual: actualBitSizes,
    });
  }

  const context: SEALContext = scope.track(
    (() => {
      try {
        return new seal.SEALContext(parms, true, securityLevel);
      } catch (error) {
        return fail(`an evaluation context cannot be built (${describeSealError(error)})`);
      }
    })(),
  );
  if (!context.parametersSet()) {
    fail('the parameters do not satisfy the declared security level');
  }

  const firstContextData = scope.track(context.firstContextData());
  const totalDataBits = firstContextData.totalCoeffModulusBitCount();
  const rescaleLevels = firstContextData.chainIndex();
  scope.release(firstContextData);

  if (rescaleLevels < 1) {
    fail('no modulus level is left for rescaling after a ciphertext-plaintext multiplication');
  }

  const scaleBits = Math.log2(metadata.scale);
  if (scaleBits >= totalDataBits) {
    fail('scale exceeds the total coefficient modulus', { scaleBits, totalDataBits });
  }

  const magnitudeBits = totalDataBits - 1 - scaleBits - CAPACITY_MARGIN_BITS;
  const magnitudeLimit = magnitudeBits > 0 ? 2 ** magnitudeBits : 0;
  for (const child of plan.children) {
    const bound = Math.max(Math.abs(child.observation.min), Math.abs(child.observation.max));
    if (bound > magnitudeLimit) {
      throw new EncryptedCustomScoreError(
        `Child "${child.key}" observed bounds exceed what key "${metadata.id}" can represent at its scale`,
        'CAPACITY_EXCEEDED',
        { keyId: metadata.id, childKey: child.key, magnitudeLimit },
      );
    }
  }

  const evaluator = scope.track(new seal.Evaluator(context));
  const encoder = scope.track(new seal.CKKSEncoder(context));

  return {
    keyId: metadata.id,
    scale: metadata.scale,
    context,
    evaluator,
    encoder,
    slotCount: encoder.slotCount(),
    magnitudeLimit,
  };
}
