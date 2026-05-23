import type { z } from 'zod';

/**
 * Error thrown by {@link parseEnv} on a failed parse.
 *
 * Carries the original `ZodError` for programmatic inspection; the message
 * is a flat human-readable list of `KEY: reason` lines for boot-time logging.
 */
export class EnvValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: z.ZodError['issues'],
  ) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

/**
 * Parse an env-record against a Zod schema with a readable error message.
 *
 * The package never reads `process.env` itself — apps pass `process.env`
 * (or a test fixture) at the call site.
 *
 * @param schema - The Zod schema to validate against.
 * @param env - Env record (typically `process.env`).
 * @returns Parsed config object inferred from the schema.
 * @throws {EnvValidationError} If validation fails.
 */
export function parseEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  env: Record<string, string | undefined>,
): z.infer<TSchema> {
  const result = schema.safeParse(env);
  if (result.success) {
    return result.data;
  }

  const lines = result.error.issues.map((issue) => {
    const key = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    return `  - ${key}: ${issue.message}`;
  });
  const message = `Invalid environment variables:\n${lines.join('\n')}`;
  throw new EnvValidationError(message, result.error.issues);
}

/**
 * Boot-time wrapper around {@link parseEnv}: logs to `stderr` and exits
 * with status 1 on failure. Intended for entry points (`main.ts`, worker
 * `run.ts`) where a thrown error would just be re-logged anyway.
 *
 * @param schema - The Zod schema to validate against.
 * @param env - Env record (typically `process.env`).
 * @param onExit - Injectable exit hook (defaults to `process.exit`).
 *   Lets tests assert the exit code without killing the test runner.
 */
export function parseEnvOrExit<TSchema extends z.ZodType>(
  schema: TSchema,
  env: Record<string, string | undefined>,
  onExit: (code: number) => never = process.exit,
): z.infer<TSchema> {
  try {
    return parseEnv(schema, env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      process.stderr.write(`${error.message}\n`);
    } else {
      process.stderr.write(`Unexpected env-parse failure: ${String(error)}\n`);
    }
    return onExit(1);
  }
}
