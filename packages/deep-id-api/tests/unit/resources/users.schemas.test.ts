import { describe, expect, it } from 'vitest';
import { parseEncryptedScores } from '../../../src/resources/users/schemas.js';
import { DeepIdContractError } from '../../../src/shared/errors/index.js';

const CIPHERTEXT = 'q1w2e3-serialized-ckks-ciphertext';
const METADATA_URL = '/v1/.well-known/seal-metadata/1c9e4a2f-7b0d-4f4e-9a2b-3c5d6e7f8a9b';

function captureError(run: () => unknown): DeepIdContractError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DeepIdContractError);
    return error as DeepIdContractError;
  }
  throw new Error('expected the call to throw');
}

describe('parseEncryptedScores', () => {
  it('returns undefined when scores_encr is absent', () => {
    expect(parseEncryptedScores(undefined)).toBeUndefined();
  });

  it('accepts encrypted, pending, null, and absent child fields', () => {
    const parsed = parseEncryptedScores({
      'seal-metadata': METADATA_URL,
      voting_engagement_encr: { ciphertext: CIPHERTEXT, status: 'encrypted' },
      contribution_score_encr: { ciphertext: null, status: 'pending_encryption' },
      proposal_engagement_encr: { ciphertext: CIPHERTEXT, status: 'pending_encryption' },
      token_value_over_time_encr: null,
    });

    expect(parsed?.['seal-metadata']).toBe(METADATA_URL);
    expect(parsed?.voting_engagement_encr).toEqual({ ciphertext: CIPHERTEXT, status: 'encrypted' });
    expect(parsed?.contribution_score_encr).toEqual({ ciphertext: null, status: 'pending_encryption' });
    expect(parsed?.proposal_engagement_encr).toEqual({ ciphertext: CIPHERTEXT, status: 'pending_encryption' });
    expect(parsed?.token_value_over_time_encr).toBeNull();

    const field = parsed?.voting_engagement_encr;
    if (field?.status === 'encrypted') {
      const ready: string = field.ciphertext;
      expect(ready).toBe(CIPHERTEXT);
    } else {
      throw new Error('expected the voting_engagement_encr field to be encrypted');
    }
  });

  it('accepts a null seal-metadata URL and no child fields at all', () => {
    const parsed = parseEncryptedScores({ 'seal-metadata': null });
    expect(parsed).toEqual({ 'seal-metadata': null });
    expect(parsed?.voting_engagement_encr).toBeUndefined();
  });

  it('tolerates and drops unknown extra fields', () => {
    const parsed = parseEncryptedScores({
      'seal-metadata': null,
      future_score_encr: { status: 'weird', ciphertext: 42 },
    });
    expect(parsed).toEqual({ 'seal-metadata': null });
  });

  it('rejects scores_encr without the seal-metadata field', () => {
    const error = captureError(() =>
      parseEncryptedScores({ voting_engagement_encr: { ciphertext: CIPHERTEXT, status: 'encrypted' } }),
    );
    expect(error.issues.some((issue) => issue.path === 'seal-metadata')).toBe(true);
  });

  it('rejects a null or non-object scores_encr', () => {
    expect(() => parseEncryptedScores(null)).toThrow(DeepIdContractError);
    expect(() => parseEncryptedScores('scores')).toThrow(DeepIdContractError);
  });

  it('rejects an unknown status without leaking the ciphertext into the error', () => {
    const error = captureError(() =>
      parseEncryptedScores({
        'seal-metadata': METADATA_URL,
        voting_engagement_encr: { ciphertext: CIPHERTEXT, status: 'failed' },
      }),
    );
    expect(error.issues.some((issue) => issue.path.startsWith('voting_engagement_encr'))).toBe(true);
    expect(error.message).not.toContain(CIPHERTEXT);
  });

  it('rejects a ready (encrypted) field with an empty ciphertext', () => {
    expect(() =>
      parseEncryptedScores({
        'seal-metadata': METADATA_URL,
        contribution_score_encr: { ciphertext: '', status: 'encrypted' },
      }),
    ).toThrow(DeepIdContractError);
  });

  it('rejects a ready (encrypted) field with a null ciphertext', () => {
    expect(() =>
      parseEncryptedScores({
        'seal-metadata': METADATA_URL,
        contribution_score_encr: { ciphertext: null, status: 'encrypted' },
      }),
    ).toThrow(DeepIdContractError);
  });
});
