import { randomUUID } from 'node:crypto';
import type { TestingModule } from '@nestjs/testing';
import type { AccessRole } from '@reputo/database';
import { PrismaService } from '../../src/persistence';
import { encryptValue } from '../../src/shared/utils';

export const AUTH_TEST_ENV = {
  NODE_ENV: 'test',
  AUTH_MODE: 'oauth',
  OWNER_EMAIL: 'behzad.rabiei.77@gmail.com',
  DEEP_ID_ISSUER_URL: 'https://identity.deep-id.ai',
  DEEP_ID_CLIENT_ID: 'deep-id-test-client',
  DEEP_ID_CLIENT_SECRET: 'deep-id-test-secret',
  DEEP_ID_AUTH_REDIRECT_URI: 'http://localhost:3000/api/v1/auth/deep-id/callback',
  DEEP_ID_AUTH_SCOPES: 'openid profile email offline_access',
  DEEP_ID_CONSENT_REDIRECT_URI: 'http://localhost:3000/api/v1/oauth/consent/deep-id/callback',
  DEEP_ID_CONSENT_GRANT_TTL_SECONDS: '600',
  // 0 disables the periodic consent cleanup cron so tests never get a stray
  // tick mid-assertion. Suites that exercise the cleanup path call `runOnce`
  // directly.
  DEEP_ID_CONSENT_CLEANUP_INTERVAL_MS: '0',
  VOTING_PORTAL_RETURN_URL: 'http://localhost:3001/voting',
  DEEP_ID_VOTING_PORTAL_SCOPES: 'api wallets',
  AUTH_COOKIE_NAME: 'reputo_test_session',
  AUTH_COOKIE_DOMAIN: '',
  AUTH_COOKIE_SECURE: 'false',
  AUTH_COOKIE_SAME_SITE: 'lax',
  AUTH_SESSION_TTL_SECONDS: '3600',
  AUTH_REFRESH_LEEWAY_SECONDS: '60',
  // 0 disables the periodic cleanup cron so tests never get a stray tick
  // mid-assertion. Suites that exercise the cleanup path call `runOnce`
  // directly.
  AUTH_SESSION_CLEANUP_INTERVAL_MS: '0',
  AUTH_TOKEN_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef',
  APP_PUBLIC_URL: 'http://localhost:5173',
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

// Seeds an authenticated session for an integration test. OAuthUser,
// AuthSession, and AccessAllowlist are persisted in Postgres (Prisma) per
// tasks 06 and 07.
export async function createAuthenticatedSession(
  moduleRef: TestingModule,
  options: CreateAuthenticatedSessionOptions = {},
) {
  const prisma = moduleRef.get(PrismaService);
  const subSuffix = randomUUID();
  const now = Date.now();
  const email = options.email ?? `${subSuffix}@example.com`;
  const normalizedEmail = email.trim().toLowerCase();
  const role = options.role ?? 'admin';
  const user = await prisma.oAuthUser.create({
    data: {
      provider: 'deep_id',
      sub: `did:deep-id:${subSuffix}`,
      email: normalizedEmail,
      emailVerified: true,
      username: `user-${subSuffix}`,
    },
  });
  const sessionId = randomUUID();

  await prisma.accessAllowlist.upsert({
    where: { provider_email: { provider: 'deep_id', email: normalizedEmail } },
    create: {
      provider: 'deep_id',
      email: normalizedEmail,
      role,
      invitedBy: null,
      invitedAt: new Date(now),
    },
    update: {
      role,
      invitedBy: null,
      revokedAt: null,
      revokedBy: null,
    },
  });

  await prisma.authSession.create({
    data: {
      sessionId,
      provider: 'deep_id',
      userId: user.id,
      accessTokenCiphertext: encryptValue(AUTH_TEST_ENV.AUTH_TOKEN_ENCRYPTION_KEY, 'provider-access-token'),
      refreshTokenCiphertext: encryptValue(AUTH_TEST_ENV.AUTH_TOKEN_ENCRYPTION_KEY, 'provider-refresh-token'),
      accessTokenExpiresAt: options.accessTokenExpiresAt ?? new Date(now + 10 * 60 * 1000),
      refreshTokenExpiresAt: options.refreshTokenExpiresAt ?? new Date(now + 30 * 60 * 1000),
      scope: options.scope ?? ['openid', 'profile', 'email', 'offline_access'],
      state: `state-${subSuffix}`,
      codeVerifier: `verifier-${subSuffix}`,
      expiresAt: options.expiresAt ?? new Date(now + 30 * 60 * 1000),
    },
  });

  return {
    cookie: `${AUTH_TEST_ENV.AUTH_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    sessionId,
    userId: user.id,
  };
}
