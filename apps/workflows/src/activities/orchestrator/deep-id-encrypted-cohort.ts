import {
  DeepIdContractError,
  ENCRYPTED_SCORE_SCOPES,
  type EncryptedScoreScope,
  parseEncryptedScores,
} from '@reputo/deep-id-api';

import type { CustomScoreChild } from '../../shared/utils/index.js';

const ENCRYPTED_SCOPE_SET = new Set<string>(ENCRYPTED_SCORE_SCOPES);

/**
 * A preset or user that breaks the encrypted-read contract. The readiness and
 * submission activities convert this into their own fatal, non-retryable
 * failure type so both passes classify the cohort identically.
 */
export class EncryptedCohortViolation extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'EncryptedCohortViolation';
  }
}

/** One selected child and the `scores_encr` scope its ciphertexts live under. */
export interface SelectedEncryptedChild {
  key: string;
  scope: EncryptedScoreScope;
}

/** Resolves each selected child's encrypted read scope; an unknown child fails the run. */
export function resolveSelectedEncryptedChildren(children: CustomScoreChild[]): SelectedEncryptedChild[] {
  return children.map((child) => {
    const scope = `${child.algorithm_key}_encr`;
    if (!ENCRYPTED_SCOPE_SET.has(scope)) {
      throw new EncryptedCohortViolation(
        `Child algorithm "${child.algorithm_key}" has no DeepID encrypted score scope`,
        {
          childKey: child.algorithm_key,
        },
      );
    }
    return { key: child.algorithm_key, scope: scope as EncryptedScoreScope };
  });
}

/** Cohort classification of one unified user for one `custom_score` run. */
export type EncryptedUserClassification =
  /** At least one selected field `null` or absent — excluded from the cohort, never zero-filled. */
  | { state: 'incomplete' }
  /** Every selected field present but at least one still `pending_encryption` — the run keeps waiting. */
  | { state: 'potentiallyComplete' }
  /** Every selected field `encrypted` — ready for homomorphic evaluation. */
  | { state: 'complete'; metadataUrl: string; ciphertexts: Record<string, string> };

/**
 * Classifies one `GET /v1/users` entry against the selected children. For a
 * complete user the returned ciphertexts are keyed by child algorithm key —
 * the shape the encrypted evaluator consumes.
 */
export function classifyEncryptedUser(
  did: string,
  scoresEncrValue: unknown,
  selectedChildren: SelectedEncryptedChild[],
): EncryptedUserClassification {
  let scoresEncr: ReturnType<typeof parseEncryptedScores>;
  try {
    scoresEncr = parseEncryptedScores(scoresEncrValue);
  } catch (error) {
    if (error instanceof DeepIdContractError) {
      throw new EncryptedCohortViolation(`DeepID user "${did}" has malformed scores_encr: ${error.message}`, {
        did,
        issues: error.issues.map((issue) => issue.path),
      });
    }
    throw error;
  }

  if (scoresEncr === undefined) {
    return { state: 'incomplete' };
  }

  const ciphertexts: Record<string, string> = {};
  let pending = 0;
  for (const child of selectedChildren) {
    const field = scoresEncr[child.scope];
    if (field === undefined || field === null) {
      return { state: 'incomplete' };
    }
    if (field.status === 'pending_encryption') {
      pending += 1;
    } else {
      ciphertexts[child.key] = field.ciphertext;
    }
  }
  if (pending > 0) {
    return { state: 'potentiallyComplete' };
  }

  const metadataUrl = scoresEncr['seal-metadata'];
  if (metadataUrl === null) {
    throw new EncryptedCohortViolation(
      `DeepID user "${did}" has every selected child encrypted but no seal-metadata reference`,
      { did },
    );
  }
  return { state: 'complete', metadataUrl, ciphertexts };
}
