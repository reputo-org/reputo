import { randomUUID } from 'node:crypto';
import type { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { AccessRole } from '@reputo/contracts';
import type { Repository } from 'typeorm';
import { AccessAllowlistEntity, AuthSessionEntity, OAuthUserEntity } from '../../src/persistence';
import { encryptValue } from '../../src/shared/utils';

export const AUTH_TEST_ENV = {
  NODE_ENV: 'test',
  AUTH_MODE: 'oauth',
  OWNER_EMAIL: 'behzad.rabiei.77@gmail.com',
  DEEP_ID_ISSUER_URL: 'https://identity.deep-id.ai',
  DEEP_ID_ADMIN_CLIENT_ID: 'deep-id-admin-client',
  DEEP_ID_ADMIN_CLIENT_SECRET: 'deep-id-admin-secret',
  DEEP_ID_ADMIN_REDIRECT_URI: 'http://localhost:3000/api/v1/auth/deep-id/callback',
  DEEP_ID_ADMIN_SCOPES: 'openid profile email offline_access',
  DEEP_ID_CLIENT_ID: 'deep-id-client',
  DEEP_ID_CLIENT_SECRET: 'deep-id-secret',
  DEEP_ID_CONSENT_REDIRECT_URI: 'http://localhost:3000/api/v1/oauth/consent/deep-id/callback',
  DEEP_ID_CONSENT_GRANT_TTL_SECONDS: '600',
  DEEP_ID_CONSENT_CLEANUP_INTERVAL_MS: '0',
  VOTING_PORTAL_RETURN_URL: 'http://localhost:3001/voting',
  DEEP_ID_CONSENT_SCOPES:
    'api wallets post_scores voting_engagement_encr contribution_score_encr proposal_engagement_encr token_value_over_time_encr github discord mattermost',
  AUTH_COOKIE_NAME: 'reputo_test_session',
  AUTH_COOKIE_DOMAIN: '',
  AUTH_COOKIE_SECURE: 'false',
  AUTH_COOKIE_SAME_SITE: 'lax',
  AUTH_SESSION_TTL_SECONDS: '3600',
  AUTH_REFRESH_LEEWAY_SECONDS: '60',
  AUTH_SESSION_CLEANUP_INTERVAL_MS: '0',
  AUTH_TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
  APP_PUBLIC_URL: 'http://localhost:5173',
  DISCORD_CLIENT_ID: 'discord-client-id',
  DISCORD_CLIENT_SECRET: 'discord-client-secret',
  DISCORD_BOT_TOKEN: 'discord-bot-token',
  DISCORD_BOT_CALLBACK_URL: 'http://localhost:3000/api/v1/community/connections/discord/callback',
  GITHUB_APP_ID: '1234',
  GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\ntest-key\\n-----END PRIVATE KEY-----',
  GITHUB_APP_SLUG: 'reputo-community',
  GITHUB_APP_CALLBACK_URL: 'http://localhost:3000/api/v1/community/connections/github/callback',
  COMMUNITY_INSTALL_STATE_TTL_SECONDS: '600',
  COMMUNITY_CREDENTIALS_ENCRYPTION_KEY: 'community-credentials-test-key-0123456789abcdef',
  COMMUNITY_MATTERMOST_ALLOWED_HOSTS: '127.0.0.1',
  COMMUNITY_MATTERMOST_MAX_RESPONSE_BYTES: '65536',
} as const;

export interface CreateAuthenticatedSessionOptions {
  accessTokenExpiresAt?: Date;
  email?: string;
  expiresAt?: Date;
  refreshTokenExpiresAt?: Date;
  role?: AccessRole;
  scope?: string[];
}

export function applyAuthTestEnv(overrides: Partial<Record<keyof typeof AUTH_TEST_ENV, string>> = {}): void {
  for (const [key, value] of Object.entries({ ...AUTH_TEST_ENV, ...overrides })) {
    process.env[key] = value;
  }
}

export async function createAuthenticatedSession(
  moduleRef: TestingModule,
  options: CreateAuthenticatedSessionOptions = {},
) {
  const userRepo = moduleRef.get<Repository<OAuthUserEntity>>(getRepositoryToken(OAuthUserEntity));
  const allowlistRepo = moduleRef.get<Repository<AccessAllowlistEntity>>(getRepositoryToken(AccessAllowlistEntity));
  const sessionRepo = moduleRef.get<Repository<AuthSessionEntity>>(getRepositoryToken(AuthSessionEntity));

  const subSuffix = randomUUID();
  const now = Date.now();
  const email = options.email ?? `${subSuffix}@example.com`;
  const normalizedEmail = email.trim().toLowerCase();
  const role = options.role ?? 'admin';

  const user = await userRepo.save(
    userRepo.create({
      provider: 'deep-id',
      sub: `did:deep-id:${subSuffix}`,
      email: normalizedEmail,
      emailVerified: true,
      username: `user-${subSuffix}`,
      aud: [],
    }),
  );

  const existingEntry = await allowlistRepo.findOne({ where: { provider: 'deep-id', email: normalizedEmail } });
  if (existingEntry) {
    existingEntry.role = role;
    existingEntry.invitedByUserId = null;
    existingEntry.revokedAt = null;
    existingEntry.revokedByUserId = null;
    await allowlistRepo.save(existingEntry);
  } else {
    await allowlistRepo.save(
      allowlistRepo.create({
        provider: 'deep-id',
        email: normalizedEmail,
        role,
        invitedByUserId: null,
        invitedAt: new Date(now),
        revokedAt: null,
        revokedByUserId: null,
      }),
    );
  }

  const sessionId = randomUUID();
  await sessionRepo.save(
    sessionRepo.create({
      sessionId,
      provider: 'deep-id',
      userId: user.id,
      accessTokenCiphertext: encryptValue(AUTH_TEST_ENV.AUTH_TOKEN_ENCRYPTION_KEY, 'provider-access-token'),
      refreshTokenCiphertext: encryptValue(AUTH_TEST_ENV.AUTH_TOKEN_ENCRYPTION_KEY, 'provider-refresh-token'),
      accessTokenExpiresAt: options.accessTokenExpiresAt ?? new Date(now + 10 * 60 * 1000),
      refreshTokenExpiresAt: options.refreshTokenExpiresAt ?? new Date(now + 30 * 60 * 1000),
      scope: options.scope ?? ['openid', 'profile', 'email', 'offline_access'],
      state: `state-${subSuffix}`,
      codeVerifier: `verifier-${subSuffix}`,
      expiresAt: options.expiresAt ?? new Date(now + 30 * 60 * 1000),
      lastRefreshedAt: null,
      revokedAt: null,
    }),
  );

  return {
    cookie: `${AUTH_TEST_ENV.AUTH_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    sessionId,
    userId: user.id,
  };
}
