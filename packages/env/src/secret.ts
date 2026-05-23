import { z } from 'zod';

/**
 * Branded non-empty string for secret env vars.
 *
 * Closes the empty-string acceptance gap (MS9 audit M4): Joi's `.allow('')`
 * lets a misconfigured secret survive validation. `secretString()` rejects
 * empty input and brands the type so callers can't confuse it with a
 * regular `string`.
 *
 * @param description - Optional description for `.env.example` generation.
 *
 * @example
 * const schema = z.object({
 *   AWS_SECRET_ACCESS_KEY: secretString('AWS secret access key'),
 * });
 */
export function secretString(description?: string) {
  const base = z.string().min(1, 'must not be empty').brand<'Secret'>();
  return description ? base.describe(description) : base;
}

/**
 * The branded `Secret` string type produced by {@link secretString}.
 */
export type Secret = z.infer<ReturnType<typeof secretString>>;
