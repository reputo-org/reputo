import { registerAs } from '@nestjs/config';
import { type OAuthProvider, OAuthProviderDeepId } from '@reputo/contracts';

import { env } from './env';

export interface OAuthProviderAuthConfig {
  clientId: string;
  clientSecret: string;
  issuerUrl: string;
  redirectUri: string;
  scope: string;
}

export interface AuthConfig {
  appPublicUrl: string;
  cookieDomain?: string;
  cookieName: string;
  cookieSameSite: string;
  cookieSecure: boolean;
  mode: string;
  ownerEmail?: string;
  ownerProvider: OAuthProvider;
  providers: Record<OAuthProvider, OAuthProviderAuthConfig>;
  refreshLeewaySeconds: number;
  // Periodic cleanup interval for expired AuthSession rows. Set to 0 to
  // disable the cron (tests, one-off scripts).
  sessionCleanupIntervalMs: number;
  sessionTtlSeconds: number;
  tokenEncryptionKey: string;
}

export default registerAs(
  'auth',
  (): AuthConfig => ({
    mode: env.AUTH_MODE,
    ownerEmail: env.OWNER_EMAIL,
    ownerProvider: env.OWNER_PROVIDER as OAuthProvider,
    providers: {
      [OAuthProviderDeepId]: {
        issuerUrl: env.DEEP_ID_ISSUER_URL,
        clientId: env.DEEP_ID_CLIENT_ID,
        clientSecret: env.DEEP_ID_CLIENT_SECRET,
        redirectUri: env.DEEP_ID_AUTH_REDIRECT_URI,
        scope: env.DEEP_ID_AUTH_SCOPES,
      },
    },
    cookieName: env.AUTH_COOKIE_NAME,
    cookieDomain: env.AUTH_COOKIE_DOMAIN,
    cookieSecure: env.AUTH_COOKIE_SECURE,
    cookieSameSite: env.AUTH_COOKIE_SAME_SITE,
    sessionTtlSeconds: env.AUTH_SESSION_TTL_SECONDS,
    refreshLeewaySeconds: env.AUTH_REFRESH_LEEWAY_SECONDS,
    sessionCleanupIntervalMs: env.AUTH_SESSION_CLEANUP_INTERVAL_MS,
    tokenEncryptionKey: env.AUTH_TOKEN_ENCRYPTION_KEY,
    appPublicUrl: env.APP_PUBLIC_URL,
  }),
);
