import type { SealMetadata } from '@reputo/deep-id-api';
import type { MainModule } from 'node-seal';
import SEAL from 'node-seal';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createEncryptedCustomScoreEvaluator,
  type EncryptedCustomScoreChild,
  type EncryptedCustomScoreEvaluator,
  type EncryptedCustomScoreUser,
} from '../../../../src/activities/typescript/algorithms/custom-score/encrypted-evaluator/index.js';
import { EncryptedCustomScoreError, type EncryptedCustomScoreErrorCode } from '../../../../src/shared/errors/index.js';

// CKKS keygen and WASM startup are slow on free-tier CI runners.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

const DEFAULT_SCALE = 2 ** 40;
const KEY_ID = 'seal-key-primary';
const ALIGN_KEY_ID = 'seal-key-align';

/**
 * Test-only SEAL key material mirroring DeepID's side of the contract: it
 * generates keys, encrypts child scores symmetrically, and decrypts final
 * results. Production evaluator code never constructs any of these objects.
 */
interface TestSealKey {
  metadata: SealMetadata;
  encrypt(value: number, options?: { scale?: number; switchDown?: number }): string;
  decrypt(serialized: string): number;
  dispose(): void;
}

function createTestSealKey(
  seal: MainModule,
  id: string,
  options: { degree?: number; bitSizes?: number[]; scale?: number } = {},
): TestSealKey {
  const { degree = 8192, bitSizes = [60, 40, 60], scale = DEFAULT_SCALE } = options;

  const parms = new seal.EncryptionParameters(seal.SchemeType.ckks);
  parms.setPolyModulusDegree(degree);
  const modulus = seal.CoeffModulus.Create(degree, Int32Array.from(bitSizes));
  parms.setCoeffModulus(modulus);
  const context = new seal.SEALContext(parms, true, seal.SecLevelType.tc128);
  if (!context.parametersSet()) {
    throw new Error(`test SEAL parameters are invalid for ${id}`);
  }
  const keyGenerator = new seal.KeyGenerator(context);
  const secretKey = keyGenerator.secretKey();
  const publicKey = keyGenerator.createPublicKey();
  const encryptor = new seal.Encryptor(context, publicKey, secretKey);
  const decryptor = new seal.Decryptor(context, secretKey);
  const encoder = new seal.CKKSEncoder(context);
  const evaluator = new seal.Evaluator(context);

  const metadata: SealMetadata = {
    id,
    schemeType: 'ckks',
    securityLevel: 128,
    polyModulusDegree: degree,
    coeffModulusBitSizes: bitSizes,
    scale,
    encryptionParameters: parms.saveToBase64(seal.ComprModeType.zstd),
  };

  return {
    metadata,
    encrypt(value, { scale: atScale = scale, switchDown = 0 } = {}) {
      const plain = new seal.Plaintext();
      encoder.encode(Float64Array.from([value]), atScale, plain);
      const ciphertext = new seal.Ciphertext();
      encryptor.encryptSymmetric(plain, ciphertext);
      for (let level = 0; level < switchDown; level++) {
        evaluator.cipherModSwitchToNextInplace(ciphertext);
      }
      const serialized = ciphertext.saveToBase64(seal.ComprModeType.zstd);
      ciphertext.delete();
      plain.delete();
      return serialized;
    },
    decrypt(serialized) {
      const ciphertext = new seal.Ciphertext();
      ciphertext.loadFromBase64(context, serialized);
      const plain = new seal.Plaintext();
      decryptor.decrypt(ciphertext, plain);
      const decoded = encoder.decodeFloat64(plain) as Float64Array;
      plain.delete();
      ciphertext.delete();
      return decoded[0];
    },
    dispose() {
      evaluator.delete();
      encoder.delete();
      decryptor.delete();
      encryptor.delete();
      publicKey.delete();
      secretKey.delete();
      keyGenerator.delete();
      context.delete();
      modulus.delete();
      parms.delete();
    },
  };
}

let seal: MainModule;
let primaryKey: TestSealKey;
let alignmentKey: TestSealKey;
let foreignKey: TestSealKey;

beforeAll(async () => {
  seal = await SEAL();
  primaryKey = createTestSealKey(seal, KEY_ID);
  alignmentKey = createTestSealKey(seal, ALIGN_KEY_ID, { bitSizes: [60, 40, 40, 60] });
  foreignKey = createTestSealKey(seal, 'seal-key-foreign', { degree: 4096, bitSizes: [35, 30, 35], scale: 2 ** 30 });
});

afterAll(() => {
  primaryKey.dispose();
  alignmentKey.dispose();
  foreignKey.dispose();
});

function child(key: string, weight: number, min: number, max: number): EncryptedCustomScoreChild {
  return { key, weight, observation: { method: 'observed_min_max', min, max } };
}

/** The parent design's plaintext formulas, applied per child then aggregated. */
function plaintextReference(children: EncryptedCustomScoreChild[], raws: Record<string, number>): number {
  const totalWeight = children.reduce((sum, entry) => sum + entry.weight, 0);
  let weightedSum = 0;
  for (const entry of children) {
    const { min, max } = entry.observation;
    let normalized = 0;
    if (min !== max) {
      const a = 100 / (max - min);
      const b = -min * a;
      normalized = a * raws[entry.key] + b;
    }
    weightedSum += entry.weight * normalized;
  }
  return weightedSum / totalWeight;
}

function encryptedUser(
  key: TestSealKey,
  did: string,
  raws: Record<string, number>,
  options: { keyId?: string; switchDown?: number } = {},
): EncryptedCustomScoreUser {
  const ciphertexts: Record<string, string> = {};
  for (const [childKey, raw] of Object.entries(raws)) {
    ciphertexts[childKey] = key.encrypt(raw, { switchDown: options.switchDown });
  }
  return { did, keyId: options.keyId ?? key.metadata.id, ciphertexts };
}

async function withEvaluator(
  children: EncryptedCustomScoreChild[],
  run: (evaluator: EncryptedCustomScoreEvaluator) => void | Promise<void>,
  metadata: SealMetadata[] = [primaryKey.metadata],
): Promise<void> {
  const evaluator = await createEncryptedCustomScoreEvaluator({ method: 'observed_min_max', children });
  try {
    for (const document of metadata) {
      evaluator.registerSealMetadata(document);
    }
    await run(evaluator);
  } finally {
    evaluator.dispose();
  }
}

function expectEvaluationError(fn: () => unknown, code: EncryptedCustomScoreErrorCode): EncryptedCustomScoreError {
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

describe('encrypted custom_score evaluation (CKKS, node-seal v7)', () => {
  it('maps the observed minimum, midpoint, and maximum near 0, 50, and 100', async () => {
    const children = [child('voting_engagement', 1, 10, 30)];
    await withEvaluator(children, (evaluator) => {
      const scores = [10, 20, 30].map((raw, index) => {
        const user = encryptedUser(primaryKey, `did:sub:min-mid-max-${index}`, { voting_engagement: raw });
        return primaryKey.decrypt(evaluator.evaluateUser(user).ciphertext);
      });
      expect(scores[0]).toBeCloseTo(0, 4);
      expect(scores[1]).toBeCloseTo(50, 4);
      expect(scores[2]).toBeCloseTo(100, 4);
    });
  });

  it('normalizes negative and large finite cohorts correctly', async () => {
    const negative = [child('voting_engagement', 1, -50, -10)];
    await withEvaluator(negative, (evaluator) => {
      const scores = [-50, -30, -10].map((raw, index) => {
        const user = encryptedUser(primaryKey, `did:sub:negative-${index}`, { voting_engagement: raw });
        return primaryKey.decrypt(evaluator.evaluateUser(user).ciphertext);
      });
      expect(scores[0]).toBeCloseTo(0, 4);
      expect(scores[1]).toBeCloseTo(50, 4);
      expect(scores[2]).toBeCloseTo(100, 4);
    });

    // CKKS quantization grows with the cohort span: at scale 2^40 a 2e9-wide
    // cohort carries an inherent ~span * 2^-41 ≈ 1e-3 absolute error.
    const large = [child('token_value_over_time', 1, -1_000_000_000, 1_000_000_000)];
    await withEvaluator(large, (evaluator) => {
      const zero = encryptedUser(primaryKey, 'did:sub:large-0', { token_value_over_time: 0 });
      expect(primaryKey.decrypt(evaluator.evaluateUser(zero).ciphertext)).toBeCloseTo(50, 2);

      const high = encryptedUser(primaryKey, 'did:sub:large-1', { token_value_over_time: 750_000_000 });
      expect(primaryKey.decrypt(evaluator.evaluateUser(high).ciphertext)).toBeCloseTo(87.5, 2);
    });
  });

  it('rejects a zero-weight child before any SEAL work happens', async () => {
    const children = [child('voting_engagement', 2, 0, 100), child('contribution_score', 0, 0, 100)];
    let failure: unknown;
    try {
      await createEncryptedCustomScoreEvaluator({ method: 'observed_min_max', children });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(EncryptedCustomScoreError);
    expect((failure as EncryptedCustomScoreError).evaluationCode).toBe('INVALID_WEIGHT');
  });

  it('matches the plaintext reference on weighted multi-child examples', async () => {
    const children = [
      child('voting_engagement', 2, 0, 100),
      child('contribution_score', 3, -20, 30),
      child('token_value_over_time', 5, 100, 200),
    ];
    const rawsPerUser: Record<string, number>[] = [
      { voting_engagement: 55, contribution_score: -5, token_value_over_time: 150 },
      { voting_engagement: 0, contribution_score: 30, token_value_over_time: 100 },
      { voting_engagement: 100, contribution_score: -20, token_value_over_time: 200 },
    ];
    await withEvaluator(children, (evaluator) => {
      rawsPerUser.forEach((raws, index) => {
        const user = encryptedUser(primaryKey, `did:sub:weighted-${index}`, raws);
        const score = primaryKey.decrypt(evaluator.evaluateUser(user).ciphertext);
        expect(score).toBeCloseTo(plaintextReference(children, raws), 4);
      });
    });
  });

  it('divides by every configured weight, keeping equal-bounds children in the denominator', async () => {
    const children = [child('voting_engagement', 1, 0, 100), child('contribution_score', 1, 7, 7)];
    await withEvaluator(children, (evaluator) => {
      const user = encryptedUser(primaryKey, 'did:sub:denominator', {
        voting_engagement: 100,
        contribution_score: 7,
      });
      expect(primaryKey.decrypt(evaluator.evaluateUser(user).ciphertext)).toBeCloseTo(50, 4);
    });
  });

  it('produces an encrypted zero for equal observed bounds', async () => {
    const children = [child('voting_engagement', 1, 7, 7)];
    await withEvaluator(children, (evaluator) => {
      const user = encryptedUser(primaryKey, 'did:sub:equal-bounds', { voting_engagement: 7 });
      const result = evaluator.evaluateUser(user);
      expect(Math.abs(primaryKey.decrypt(result.ciphertext))).toBeLessThan(1e-6);
    });

    // Two equal-bounds children (both weighted) still hit the all-zero path,
    // since only a real spread produces an affine (weight-sensitive) contribution.
    const negativeBound = [child('voting_engagement', 1, -3, -3), child('contribution_score', 2, 5, 5)];
    await withEvaluator(negativeBound, (evaluator) => {
      const user = encryptedUser(primaryKey, 'did:sub:equal-bounds-negative', {
        voting_engagement: -3,
        contribution_score: 5,
      });
      expect(Math.abs(primaryKey.decrypt(evaluator.evaluateUser(user).ciphertext))).toBeLessThan(1e-6);
    });
  });

  it('evaluates a user whose selected children all emitted native zeros from the normal ciphertexts', async () => {
    const children = [child('voting_engagement', 1, -10, 40), child('contribution_score', 3, 0, 50)];
    await withEvaluator(children, (evaluator) => {
      const raws = { voting_engagement: 0, contribution_score: 0 };
      const user = encryptedUser(primaryKey, 'did:sub:native-zeros', raws);
      const score = primaryKey.decrypt(evaluator.evaluateUser(user).ciphertext);
      expect(score).toBeCloseTo(plaintextReference(children, raws), 4);
      expect(score).toBeCloseTo(5, 4);
    });
  });

  it('rejects an incomplete selected ciphertext set at the evaluator boundary', async () => {
    const children = [child('voting_engagement', 1, 0, 100), child('contribution_score', 1, 0, 100)];
    await withEvaluator(children, (evaluator) => {
      const missing = encryptedUser(primaryKey, 'did:sub:missing', { voting_engagement: 10 });
      expectEvaluationError(() => evaluator.evaluateUser(missing), 'INCOMPLETE_CIPHERTEXT_SET');

      const empty = encryptedUser(primaryKey, 'did:sub:empty', { voting_engagement: 10 });
      empty.ciphertexts.contribution_score = '';
      expectEvaluationError(() => evaluator.evaluateUser(empty), 'INCOMPLETE_CIPHERTEXT_SET');

      const extra = encryptedUser(primaryKey, 'did:sub:extra', {
        voting_engagement: 10,
        contribution_score: 20,
        proposal_engagement: 30,
      });
      expectEvaluationError(() => evaluator.evaluateUser(extra), 'INCOMPLETE_CIPHERTEXT_SET');
    });
  });

  it('rejects users referencing an unregistered metadata key', async () => {
    const children = [child('voting_engagement', 1, 0, 100)];
    await withEvaluator(children, (evaluator) => {
      expect(evaluator.hasKey(KEY_ID)).toBe(true);
      expect(evaluator.hasKey('seal-key-unknown')).toBe(false);
      const user = encryptedUser(primaryKey, 'did:sub:unknown-key', { voting_engagement: 10 });
      user.keyId = 'seal-key-unknown';
      expectEvaluationError(() => evaluator.evaluateUser(user), 'UNREGISTERED_KEY');
    });
  });

  it('rejects mixed-key and corrupt ciphertexts', async () => {
    const children = [child('voting_engagement', 1, 0, 100)];
    await withEvaluator(children, (evaluator) => {
      const foreign: EncryptedCustomScoreUser = {
        did: 'did:sub:foreign',
        keyId: KEY_ID,
        ciphertexts: { voting_engagement: foreignKey.encrypt(10) },
      };
      expectEvaluationError(() => evaluator.evaluateUser(foreign), 'INCOMPATIBLE_CIPHERTEXT');

      const valid = primaryKey.encrypt(10);
      const corrupt: EncryptedCustomScoreUser = {
        did: 'did:sub:corrupt',
        keyId: KEY_ID,
        ciphertexts: { voting_engagement: `AAAAAAAA${valid.slice(8)}` },
      };
      expectEvaluationError(() => evaluator.evaluateUser(corrupt), 'INCOMPATIBLE_CIPHERTEXT');

      const truncated: EncryptedCustomScoreUser = {
        did: 'did:sub:truncated',
        keyId: KEY_ID,
        ciphertexts: { voting_engagement: valid.slice(0, 64) },
      };
      expectEvaluationError(() => evaluator.evaluateUser(truncated), 'INCOMPATIBLE_CIPHERTEXT');
    });
  });

  it('rejects ciphertexts that are not at the metadata scale', async () => {
    const children = [child('voting_engagement', 1, 0, 100)];
    await withEvaluator(children, (evaluator) => {
      const user: EncryptedCustomScoreUser = {
        did: 'did:sub:wrong-scale',
        keyId: KEY_ID,
        ciphertexts: { voting_engagement: primaryKey.encrypt(10, { scale: 2 ** 30 }) },
      };
      expectEvaluationError(() => evaluator.evaluateUser(user), 'INCOMPATIBLE_CIPHERTEXT');
    });
  });

  it('rejects incompatible or contradictory SEAL metadata', async () => {
    const children = [child('voting_engagement', 1, 0, 100)];
    await withEvaluator(children, (evaluator) => {
      const cases: Array<{ metadata: SealMetadata; expectCode: EncryptedCustomScoreErrorCode }> = [
        {
          metadata: { ...primaryKey.metadata, id: 'k-degree', polyModulusDegree: 4096 },
          expectCode: 'INCOMPATIBLE_METADATA',
        },
        {
          metadata: { ...primaryKey.metadata, id: 'k-bits', coeffModulusBitSizes: [60, 40, 40] },
          expectCode: 'INCOMPATIBLE_METADATA',
        },
        {
          metadata: { ...primaryKey.metadata, id: 'k-security', securityLevel: 999 },
          expectCode: 'INCOMPATIBLE_METADATA',
        },
        {
          metadata: { ...primaryKey.metadata, id: 'k-garbage', encryptionParameters: 'AAAA' },
          expectCode: 'INCOMPATIBLE_METADATA',
        },
        {
          metadata: { ...primaryKey.metadata, id: 'k-scale', scale: 2 ** 200 },
          expectCode: 'INCOMPATIBLE_METADATA',
        },
      ];
      for (const { metadata, expectCode } of cases) {
        expectEvaluationError(() => evaluator.registerSealMetadata(metadata), expectCode);
      }
    });
  });

  it('rejects metadata without a rescaling level and non-CKKS parameters', async () => {
    const children = [child('voting_engagement', 1, 0, 100)];

    const shallowParms = new seal.EncryptionParameters(seal.SchemeType.ckks);
    shallowParms.setPolyModulusDegree(8192);
    const shallowModulus = seal.CoeffModulus.Create(8192, Int32Array.from([60, 40]));
    shallowParms.setCoeffModulus(shallowModulus);
    const shallowSerialized = shallowParms.saveToBase64(seal.ComprModeType.zstd);
    shallowModulus.delete();
    shallowParms.delete();

    const bfvParms = new seal.EncryptionParameters(seal.SchemeType.bfv);
    bfvParms.setPolyModulusDegree(4096);
    const bfvModulus = seal.CoeffModulus.BFVDefault(4096, seal.SecLevelType.tc128);
    bfvParms.setCoeffModulus(bfvModulus);
    const bfvPlainModulus = seal.PlainModulus.Batching(4096, 20);
    bfvParms.setPlainModulus(bfvPlainModulus);
    const bfvSerialized = bfvParms.saveToBase64(seal.ComprModeType.zstd);
    bfvPlainModulus.delete();
    bfvModulus.delete();
    bfvParms.delete();

    await withEvaluator(children, (evaluator) => {
      expectEvaluationError(
        () =>
          evaluator.registerSealMetadata({
            ...primaryKey.metadata,
            id: 'k-shallow',
            coeffModulusBitSizes: [60, 40],
            encryptionParameters: shallowSerialized,
          }),
        'INCOMPATIBLE_METADATA',
      );
      expectEvaluationError(
        () =>
          evaluator.registerSealMetadata({
            id: 'k-bfv',
            schemeType: 'ckks',
            securityLevel: 128,
            polyModulusDegree: 4096,
            coeffModulusBitSizes: [36, 36, 37],
            scale: 2 ** 20,
            encryptionParameters: bfvSerialized,
          }),
        'INCOMPATIBLE_METADATA',
      );
    });
  });

  it('rejects an unsupported normalization method before touching ciphertexts', async () => {
    let failure: unknown;
    try {
      await createEncryptedCustomScoreEvaluator({
        method: 'configured_bounds',
        children: [child('voting_engagement', 1, 0, 100)],
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(EncryptedCustomScoreError);
    expect((failure as EncryptedCustomScoreError).evaluationCode).toBe('UNSUPPORTED_NORMALIZATION_METHOD');
  });

  it('rejects observed bounds beyond the CKKS numeric capacity', async () => {
    const children = [child('token_value_over_time', 1, 0, 1e17)];
    const evaluator = await createEncryptedCustomScoreEvaluator({ method: 'observed_min_max', children });
    try {
      expectEvaluationError(() => evaluator.registerSealMetadata(primaryKey.metadata), 'CAPACITY_EXCEEDED');
    } finally {
      evaluator.dispose();
    }
  });

  it('aligns mixed-level ciphertexts onto a common modulus level', async () => {
    const children = [child('voting_engagement', 1, 0, 100), child('contribution_score', 1, -20, 30)];
    const raws = { voting_engagement: 60, contribution_score: 5 };
    await withEvaluator(
      children,
      (evaluator) => {
        const user: EncryptedCustomScoreUser = {
          did: 'did:sub:mixed-levels',
          keyId: ALIGN_KEY_ID,
          ciphertexts: {
            voting_engagement: alignmentKey.encrypt(raws.voting_engagement),
            contribution_score: alignmentKey.encrypt(raws.contribution_score, { switchDown: 1 }),
          },
        };
        const score = alignmentKey.decrypt(evaluator.evaluateUser(user).ciphertext);
        expect(score).toBeCloseTo(plaintextReference(children, raws), 3);
      },
      [alignmentKey.metadata],
    );
  });

  it('fails when ciphertext levels leave no room to rescale', async () => {
    const children = [child('voting_engagement', 1, 0, 100)];
    await withEvaluator(children, (evaluator) => {
      const user = encryptedUser(primaryKey, 'did:sub:no-levels', { voting_engagement: 10 }, { switchDown: 1 });
      expectEvaluationError(() => evaluator.evaluateUser(user), 'IMPOSSIBLE_ALIGNMENT');
    });
  });

  it('evaluates bounded batches and rejects oversized ones', async () => {
    const children = [child('voting_engagement', 2, 0, 100), child('contribution_score', 3, -20, 30)];
    await withEvaluator(children, (evaluator) => {
      const rawsPerUser = [
        { voting_engagement: 10, contribution_score: -20 },
        { voting_engagement: 50, contribution_score: 5 },
        { voting_engagement: 100, contribution_score: 30 },
      ];
      const users = rawsPerUser.map((raws, index) => encryptedUser(primaryKey, `did:sub:batch-${index}`, raws));
      const results = evaluator.evaluateBatch(users);

      expect(results).toHaveLength(users.length);
      results.forEach((result, index) => {
        expect(Object.keys(result).sort()).toEqual(['ciphertext', 'did', 'keyId']);
        expect(result.did).toBe(users[index].did);
        expect(result.keyId).toBe(KEY_ID);
        expect(result.ciphertext.length).toBeGreaterThan(0);
        expect(primaryKey.decrypt(result.ciphertext)).toBeCloseTo(plaintextReference(children, rawsPerUser[index]), 4);
      });

      const oversized = Array.from({ length: 1001 }, (_, index) => ({
        did: `did:sub:oversized-${index}`,
        keyId: KEY_ID,
        ciphertexts: {},
      }));
      expectEvaluationError(() => evaluator.evaluateBatch(oversized), 'BATCH_LIMIT_EXCEEDED');
    });
  });

  it('keeps WASM handle usage flat across repeated multi-page evaluation', { timeout: 120_000 }, async () => {
    const children = [child('voting_engagement', 1, 0, 100), child('contribution_score', 2, -20, 30)];
    const raws = { voting_engagement: 75, contribution_score: 10 };
    const expected = plaintextReference(children, raws);

    const evaluator = await createEncryptedCustomScoreEvaluator({ method: 'observed_min_max', children });
    try {
      evaluator.registerSealMetadata(primaryKey.metadata);
      evaluator.registerSealMetadata(primaryKey.metadata);
      const baseline = evaluator.stats();
      expect(baseline.registeredKeys).toBe(1);
      expect(baseline.liveHandles).toBeGreaterThan(0);

      const pageSize = 5;
      for (let page = 0; page < 10; page++) {
        const users = Array.from({ length: pageSize }, (_, index) =>
          encryptedUser(primaryKey, `did:sub:page-${page}-${index}`, raws),
        );
        const results = evaluator.evaluateBatch(users);
        expect(primaryKey.decrypt(results[0].ciphertext)).toBeCloseTo(expected, 4);
        // Every per-user WASM object must be released page by page.
        expect(evaluator.stats().liveHandles).toBe(baseline.liveHandles);
      }
    } finally {
      evaluator.dispose();
    }
    expect(evaluator.stats()).toEqual({ registeredKeys: 0, liveHandles: 0 });
  });

  it('releases handles and rejects use after dispose', async () => {
    const children = [child('voting_engagement', 1, 0, 100)];
    const evaluator = await createEncryptedCustomScoreEvaluator({ method: 'observed_min_max', children });
    evaluator.registerSealMetadata(primaryKey.metadata);
    const user = encryptedUser(primaryKey, 'did:sub:dispose', { voting_engagement: 10 });
    evaluator.evaluateUser(user);

    evaluator.dispose();
    evaluator.dispose();
    expect(evaluator.stats()).toEqual({ registeredKeys: 0, liveHandles: 0 });
    expectEvaluationError(() => evaluator.evaluateUser(user), 'EVALUATOR_DISPOSED');
    expectEvaluationError(() => evaluator.registerSealMetadata(primaryKey.metadata), 'EVALUATOR_DISPOSED');
  });
});
