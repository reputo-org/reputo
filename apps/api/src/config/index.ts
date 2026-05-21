import * as Joi from 'joi';
import appConfig, { appConfigSchema } from './app.config';
import authConfig, { authConfigSchema } from './auth.config';
import awsConfig, { awsConfigSchema } from './aws.config';
import consentConfig, { consentConfigSchema } from './consent.config';
import databaseConfig, { databaseConfigSchema } from './database.config';
import loggerConfig, { loggerConfigSchema } from './logger.config';
import mongoDBConfig, { mongoDBConfigSchema } from './mongoDB.config';
import storageConfig, { storageConfigSchema } from './storage.config';
import temporalConfig, { temporalConfigSchema } from './temporal.config';

export const configModules = [
  appConfig,
  authConfig,
  awsConfig,
  consentConfig,
  databaseConfig,
  loggerConfig,
  mongoDBConfig,
  storageConfig,
  temporalConfig,
];

export const configValidationSchema = Joi.object({
  ...appConfigSchema,
  ...authConfigSchema,
  ...awsConfigSchema,
  ...consentConfigSchema,
  ...databaseConfigSchema,
  ...loggerConfigSchema,
  ...mongoDBConfigSchema,
  ...storageConfigSchema,
  ...temporalConfigSchema,
});
