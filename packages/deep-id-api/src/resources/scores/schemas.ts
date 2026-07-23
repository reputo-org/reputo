import { z } from 'zod';
import { type PostScoresRequest, type PostScoresResponse, SCORE_TYPES, type ScoreEntry } from './types.js';

/** Full ISO 8601 date-time with `Z` or a numeric offset; date-only and zone-less values are rejected. */
const isoTimestampSchema = z.iso.datetime({ offset: true });

/** Plaintext child entry. Strict: a stray `ciphertext` (or any unknown key) is rejected, never stripped. */
export const plainScoreEntrySchema = z.strictObject({
  score: z.number(),
  type: z.enum(SCORE_TYPES),
  timestamp: isoTimestampSchema,
});

/** Final encrypted entry. Strict: a stray `score` (or any unknown key) is rejected, never stripped. */
export const encryptedScoreEntrySchema = z.strictObject({
  ciphertext: z.string().min(1),
  keyId: z.string().min(1),
  type: z.literal('custom_score_encr'),
  timestamp: isoTimestampSchema,
});

/** One request entry, discriminated on `type`. */
export const scoreEntrySchema: z.ZodType<ScoreEntry> = z.discriminatedUnion('type', [
  plainScoreEntrySchema,
  encryptedScoreEntrySchema,
]);

/** Full request body: DID → entry. DIDs are posted verbatim (use `isValidDid` to pre-filter rows). */
export const postScoresRequestSchema: z.ZodType<PostScoresRequest> = z.record(z.string(), scoreEntrySchema);

/** Response body; unknown fields are tolerated and dropped. */
export const postScoresResponseSchema: z.ZodType<PostScoresResponse> = z.object({
  status: z.object({ ok: z.number().int().nonnegative(), failed: z.number().int().nonnegative() }),
  results: z.record(z.string(), z.object({ message: z.string() })),
});
