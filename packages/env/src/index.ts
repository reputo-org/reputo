/**
 * @reputo/env
 *
 * Framework-agnostic Zod schemas for cross-app env shapes. Composed by
 * `@reputo/api`, `@reputo/workflows`, and `@reputo/ui` at boot time.
 *
 * The package never reads `process.env` itself — apps pass `process.env`
 * (or a test fixture) to {@link parseEnv} at the call site.
 *
 * @packageDocumentation
 */

export { type AwsEnv, awsEnvSchema } from './aws.js';
export {
  type GenerateEnvExampleOptions,
  generateEnvExample,
} from './generate-example.js';
export { type LoggerEnv, loggerEnvSchema } from './logger.js';
export { EnvValidationError, parseEnv, parseEnvOrExit } from './parse.js';
export {
  LOG_LEVELS,
  type LogLevel,
  NODE_ENVS,
  type NodeEnv,
  type RuntimeEnv,
  runtimeEnvSchema,
} from './runtime.js';
export { type Secret, secretString } from './secret.js';
export {
  parseContentTypeAllowlist,
  type StorageEnv,
  storageEnvSchema,
} from './storage.js';
export { type TemporalEnv, taskQueueSchema, temporalEnvSchema } from './temporal.js';
