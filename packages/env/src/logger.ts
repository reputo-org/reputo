import { z } from 'zod';
import { LOG_LEVELS, type LogLevel } from './runtime.js';

/**
 * Standalone `LOG_LEVEL` schema for apps that don't want the full
 * {@link runtimeEnvSchema} (e.g. a CLI that doesn't care about `NODE_ENV`).
 */
export const loggerEnvSchema = z.object({
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info').describe('Pino log level'),
});

export type LoggerEnv = z.infer<typeof loggerEnvSchema>;

export { LOG_LEVELS, type LogLevel };
