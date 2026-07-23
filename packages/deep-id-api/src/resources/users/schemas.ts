import { z } from 'zod';
import { parseWithContract } from '../../shared/validation/index.js';
import type { DeepIdEncryptedScores, EncryptedScoreField } from './types.js';

/**
 * One `scores_encr` child field. `encrypted` requires a non-empty ciphertext —
 * a ready field without one breaks the contract (DeepID accepted the raw score
 * but returned nothing usable). `pending_encryption` may carry `null`. Unknown
 * statuses are rejected, never coerced.
 */
export const encryptedScoreFieldSchema: z.ZodType<EncryptedScoreField> = z.discriminatedUnion('status', [
  z.object({ status: z.literal('encrypted'), ciphertext: z.string().min(1) }),
  z.object({ status: z.literal('pending_encryption'), ciphertext: z.string().nullable() }),
]);

/**
 * The whole `scores_encr` object: a required (nullable) `seal-metadata` URL
 * plus one optional, nullable field per known encrypted scope. Unknown extra
 * fields are tolerated and dropped.
 */
export const encryptedScoresSchema: z.ZodType<DeepIdEncryptedScores> = z.object({
  'seal-metadata': z.string().nullable(),
  voting_engagement_encr: encryptedScoreFieldSchema.nullable().optional(),
  contribution_score_encr: encryptedScoreFieldSchema.nullable().optional(),
  proposal_engagement_encr: encryptedScoreFieldSchema.nullable().optional(),
  token_value_over_time_encr: encryptedScoreFieldSchema.nullable().optional(),
});

/**
 * Validates a user's `scores_encr` value. Returns `undefined` when the field
 * is absent (no encrypted scope was requested or consented) — absence is a
 * valid state, not an error. Throws `DeepIdContractError` for a malformed
 * object, an unknown status, or an `encrypted` field without a ciphertext.
 */
export function parseEncryptedScores(value: unknown): DeepIdEncryptedScores | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseWithContract(encryptedScoresSchema, value, 'invalid scores_encr in DeepID user');
}
