import { z } from 'zod';

const DEFAULT_PRESIGN_PUT_TTL_SECONDS = 120;
const DEFAULT_PRESIGN_GET_TTL_SECONDS = 300;
const DEFAULT_MAX_SIZE_BYTES = 52_428_800;
const DEFAULT_CONTENT_TYPE_ALLOWLIST = 'text/csv,text/plain,application/json';

/**
 * Shared S3-backed storage env shape.
 *
 * `STORAGE_CONTENT_TYPE_ALLOWLIST` is exposed both as the raw CSV string
 * (what env vars actually look like) and as a parsed `string[]` so consumers
 * can iterate without re-splitting.
 */
export const storageEnvSchema = z.object({
  STORAGE_BUCKET: z.string().min(1).describe('S3 bucket name for algorithm inputs and outputs'),
  STORAGE_PRESIGN_PUT_TTL: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_PRESIGN_PUT_TTL_SECONDS)
    .describe('Presigned PUT URL TTL in seconds'),
  STORAGE_PRESIGN_GET_TTL: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_PRESIGN_GET_TTL_SECONDS)
    .describe('Presigned GET URL TTL in seconds'),
  STORAGE_MAX_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_MAX_SIZE_BYTES)
    .describe('Maximum object size in bytes (default 50 MiB)'),
  STORAGE_CONTENT_TYPE_ALLOWLIST: z
    .string()
    .min(1)
    .default(DEFAULT_CONTENT_TYPE_ALLOWLIST)
    .describe('Comma-separated list of allowed MIME types'),
});

export type StorageEnv = z.infer<typeof storageEnvSchema>;

/**
 * Split the CSV allowlist into a trimmed, non-empty string array.
 *
 * Kept as a helper rather than a `.transform()` so the schema's parsed shape
 * still matches the raw env var (avoids surprising consumers and keeps
 * `generateEnvExample` straightforward).
 */
export function parseContentTypeAllowlist(csv: string): string[] {
  return csv
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}
