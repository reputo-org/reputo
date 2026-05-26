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

export function validateEnv(): Record<string, unknown> {
  return env as unknown as Record<string, unknown>;
}

export { envSchema };
