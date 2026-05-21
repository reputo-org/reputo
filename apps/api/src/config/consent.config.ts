import { registerAs } from '@nestjs/config';
import { type OAuthProvider, OAuthProviderDeepId } from '@reputo/contracts';
import * as Joi from 'joi';

export interface ConsentSourceConfig {
  returnUrl: string;
}

export interface ConsentProviderSourceConfig {
  scope: string;
}

export interface ConsentProviderConfig {
  grantTtlSeconds: number;
  redirectUri: string;
  sources: Record<string, ConsentProviderSourceConfig>;
}

export interface ConsentConfig {
  // Periodic cleanup interval for the PG replacement of the Mongo TTL on
  // OAuthConsentGrant. Set to 0 to disable the cron (tests, one-off scripts).
  grantCleanupIntervalMs: number;
  providers: Record<OAuthProvider, ConsentProviderConfig>;
  sources: Record<string, ConsentSourceConfig>;
}

export default registerAs(
  'consent',
  (): ConsentConfig => ({
    grantCleanupIntervalMs: Number(process.env.DEEP_ID_CONSENT_CLEANUP_INTERVAL_MS ?? 5 * 60 * 1000),
    providers: {
      [OAuthProviderDeepId]: {
        redirectUri: process.env.DEEP_ID_CONSENT_REDIRECT_URI as string,
        grantTtlSeconds: Number(process.env.DEEP_ID_CONSENT_GRANT_TTL_SECONDS),
        sources: {
          'voting-portal': {
            scope: process.env.DEEP_ID_VOTING_PORTAL_SCOPES as string,
          },
        },
      },
    },
    sources: {
      'voting-portal': {
        returnUrl: process.env.VOTING_PORTAL_RETURN_URL as string,
      },
    },
  }),
);

export const consentConfigSchema = {
  DEEP_ID_CONSENT_REDIRECT_URI: Joi.string()
    .uri()
    .required()
    .description('Deep ID OAuth callback URL for consent flows'),
  DEEP_ID_CONSENT_GRANT_TTL_SECONDS: Joi.number()
    .integer()
    .positive()
    .required()
    .description('Transient Deep ID consent grant lifetime in seconds'),
  DEEP_ID_CONSENT_CLEANUP_INTERVAL_MS: Joi.number()
    .integer()
    .min(0)
    .default(5 * 60 * 1000)
    .description('Interval (ms) for the consent-grant expiry cleanup job; 0 disables the cron'),
  VOTING_PORTAL_RETURN_URL: Joi.string().uri().required().description('Voting Portal return URL after consent'),
  DEEP_ID_VOTING_PORTAL_SCOPES: Joi.string()
    .required()
    .description('Deep ID scopes requested for Voting Portal consent'),
};
