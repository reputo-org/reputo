import appConfig from './app.config';
import authConfig from './auth.config';
import awsConfig from './aws.config';
import consentConfig from './consent.config';
import databaseConfig from './database.config';
import { env, envSchema } from './env';
import loggerConfig from './logger.config';
import storageConfig from './storage.config';
import temporalConfig from './temporal.config';

export const configModules = [
  appConfig,
  authConfig,
  awsConfig,
  consentConfig,
  databaseConfig,
  loggerConfig,
  storageConfig,
  temporalConfig,
];

// `env` is already parsed at module-load time inside `./env`. The
// `ConfigModule.forRoot({ validate })` callback receives the raw `process.env`
// and must either return the validated object or throw. Re-parsing here keeps
// the surface aligned with `@nestjs/config` expectations without duplicating
// the error-formatting in two places: `./env` is the canonical thrower, and
// this callback is the integration point.
export function validateEnv(): Record<string, unknown> {
  return env as unknown as Record<string, unknown>;
}

export { envSchema };
