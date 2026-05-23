import { z } from 'zod';

/**
 * Pino log levels, in order of severity (highest → lowest).
 */
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Node runtime environments accepted across all Reputo apps.
 */
export const NODE_ENVS = ['production', 'development', 'test'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

/**
 * Shared `NODE_ENV` + `LOG_LEVEL` env shape.
 *
 * `LOG_LEVEL` defaults to `'info'`, matching the api app (workflows used a
 * free-form string before; this schema tightens it to the Pino enum).
 */
export const runtimeEnvSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).describe('Node runtime environment'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info').describe('Pino log level'),
});

export type RuntimeEnv = z.infer<typeof runtimeEnvSchema>;
