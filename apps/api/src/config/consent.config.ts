import { registerAs } from '@nestjs/config';
import { type OAuthProvider, OAuthProviderDeepId } from '@reputo/contracts';

import { env } from './env';

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
  // Periodic cleanup interval for expired OAuthConsentGrant rows. Set to 0
  // to disable the cron (tests, one-off scripts).
  grantCleanupIntervalMs: number;
  providers: Record<OAuthProvider, ConsentProviderConfig>;
  sources: Record<string, ConsentSourceConfig>;
}

export default registerAs(
  'consent',
  (): ConsentConfig => ({
    grantCleanupIntervalMs: env.DEEP_ID_CONSENT_CLEANUP_INTERVAL_MS,
    providers: {
      [OAuthProviderDeepId]: {
        redirectUri: env.DEEP_ID_CONSENT_REDIRECT_URI,
        grantTtlSeconds: env.DEEP_ID_CONSENT_GRANT_TTL_SECONDS,
        sources: {
          'voting-portal': {
            scope: env.DEEP_ID_VOTING_PORTAL_SCOPES,
          },
        },
      },
    },
    sources: {
      'voting-portal': {
        returnUrl: env.VOTING_PORTAL_RETURN_URL,
      },
    },
  }),
);
