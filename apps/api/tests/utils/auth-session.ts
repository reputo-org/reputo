import { randomUUID } from 'node:crypto';
import { getModelToken } from '@nestjs/mongoose';
import type { TestingModule } from '@nestjs/testing';
import type { AccessAllowlist, AccessRole, AuthSession, OAuthUser } from '@reputo/database';
import { MODEL_NAMES } from '@reputo/database';
import type { Model } from 'mongoose';
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
  VOTING_PORTAL_RETURN_URL: 'http://localhost:3001/voting',
  DEEP_ID_VOTING_PORTAL_SCOPES: 'api wallets',
  AUTH_COOKIE_NAME: 'reputo_test_session',
  AUTH_COOKIE_DOMAIN: '',
  AUTH_COOKIE_SECURE: 'false',
  AUTH_COOKIE_SAME_SITE: 'lax',
  AUTH_SESSION_TTL_SECONDS: '3600',
  AUTH_REFRESH_LEEWAY_SECONDS: '60',
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

export async function createAuthenticatedSession(
  moduleRef: TestingModule,
  options: CreateAuthenticatedSessionOptions = {},
) {
  const authSessionModel = moduleRef.get<Model<AuthSession>>(getModelToken(MODEL_NAMES.AUTH_SESSION));
  const oauthUserModel = moduleRef.get<Model<OAuthUser>>(getModelToken(MODEL_NAMES.OAUTH_USER));
  const accessAllowlistModel = moduleRef.get<Model<AccessAllowlist>>(getModelToken(MODEL_NAMES.ACCESS_ALLOWLIST));
  const subSuffix = randomUUID();
  const now = Date.now();
  const email = options.email ?? `${subSuffix}@example.com`;
  const role = options.role ?? 'admin';
  const user = await oauthUserModel.create({
    provider: 'deep-id',
    sub: `did:deep-id:${subSuffix}`,
    email,
    email_verified: true,
    username: `user-${subSuffix}`,
  });
  const sessionId = randomUUID();

  await accessAllowlistModel.updateOne(
    {
      provider: 'deep-id',
      email: email.trim().toLowerCase(),
    },
    {
      $set: {
        provider: 'deep-id',
        email: email.trim().toLowerCase(),
        role,
        invitedBy: null,
      },
      $setOnInsert: {
        invitedAt: new Date(now),
      },
      $unset: {
        revokedAt: '',
        revokedBy: '',
      },
    },
    { upsert: true },
  );

  await authSessionModel.create({
    sessionId,
    provider: 'deep-id',
    userId: user._id,
    accessTokenCiphertext: encryptValue(AUTH_TEST_ENV.AUTH_TOKEN_ENCRYPTION_KEY, 'provider-access-token'),
    refreshTokenCiphertext: encryptValue(AUTH_TEST_ENV.AUTH_TOKEN_ENCRYPTION_KEY, 'provider-refresh-token'),
    accessTokenExpiresAt: options.accessTokenExpiresAt ?? new Date(now + 10 * 60 * 1000),
    refreshTokenExpiresAt: options.refreshTokenExpiresAt ?? new Date(now + 30 * 60 * 1000),
    scope: options.scope ?? ['openid', 'profile', 'email', 'offline_access'],
    state: `state-${subSuffix}`,
    codeVerifier: `verifier-${subSuffix}`,
    expiresAt: options.expiresAt ?? new Date(now + 30 * 60 * 1000),
  });

  return {
    cookie: `${AUTH_TEST_ENV.AUTH_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
    sessionId,
    userId: user._id.toString(),
  };
}
