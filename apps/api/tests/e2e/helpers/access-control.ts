import type { INestApplication } from '@nestjs/common';
import type { AccessAllowlist, AccessRole, OAuthProvider } from '@reputo/database';
import { OAuthProviderDeepId } from '@reputo/database';
import type { Model, Types } from 'mongoose';
import supertest from 'supertest';
import { vi } from 'vitest';
import type { OAuthAuthProviderService } from '../../../src/auth/oauth-auth-provider.service';
import type {
  AuthFlowState,
  OAuthDiscoveryDocument,
  OAuthTokenResponse,
  OAuthUserInfo,
} from '../../../src/shared/types';
import { AUTH_TEST_ENV } from '../../utils/auth-session';
import { base } from '../../utils/request';

type OAuthProviderServiceDouble = Pick<
  OAuthAuthProviderService,
  | 'buildAuthorizationUrl'
  | 'exchangeCodeForTokens'
  | 'fetchUserInfo'
  | 'getDiscoveryDocument'
  | 'getScopes'
  | 'refreshTokens'
>;

export interface MockOAuthUserInfoInput {
  email: string;
  emailVerified: boolean;
  sub: string;
  username?: string;
}

export interface MockOAuthProviderDouble {
  queueTokenResponse(tokenResponse: OAuthTokenResponse): void;
  queueUserInfo(userInfo: MockOAuthUserInfoInput): void;
  reset(): void;
  service: OAuthProviderServiceDouble;
}

export interface SeedAllowlistOptions {
  invitedAt?: Date;
  invitedBy?: Types.ObjectId | string | null;
  provider?: OAuthProvider;
  revokedAt?: Date;
  revokedBy?: Types.ObjectId | string | null;
}

export interface LoginAsMockedProviderOptions extends MockOAuthUserInfoInput {
  app: INestApplication;
  code?: string;
  oauthProvider: MockOAuthProviderDouble;
}

export interface LoginAsMockedProviderResult {
  agent: ReturnType<typeof supertest.agent>;
  callbackResponse: supertest.Response;
  cookie?: string;
  loginResponse: supertest.Response;
}

export type AuthenticatedRequestMethod = 'delete' | 'get' | 'post';
export type AuthenticatedRequestBody = object | string;

const DEFAULT_SCOPES = ['openid', 'profile', 'email', 'offline_access'];

export function createMockOAuthProviderDouble(): MockOAuthProviderDouble {
  const queuedTokenResponses: OAuthTokenResponse[] = [];
  const queuedUserInfo: OAuthUserInfo[] = [];
  const getScopes = vi.fn((_provider: OAuthProvider) => DEFAULT_SCOPES);
  const buildAuthorizationUrl = vi.fn(async (_provider: OAuthProvider, authFlow: AuthFlowState) => {
    const url = new URL('https://identity.deep-id.ai/oauth2/auth');
    url.searchParams.set('state', authFlow.state);
    return url.toString();
  });
  const exchangeCodeForTokens = vi.fn(async (_provider: OAuthProvider, code: string) => {
    return (
      queuedTokenResponses.shift() ?? {
        access_token: `provider-access-token-${code}`,
        refresh_token: `provider-refresh-token-${code}`,
        expires_in: 300,
        refresh_token_expires_in: 1800,
        token_type: 'Bearer',
        scope: DEFAULT_SCOPES.join(' '),
      }
    );
  });
  const refreshTokens = vi.fn(async () => {
    const tokenResponse = queuedTokenResponses.shift();

    if (!tokenResponse) {
      throw new Error('No mocked OAuth token response queued for refresh.');
    }

    return tokenResponse;
  });
  const fetchUserInfo = vi.fn(async () => {
    const userInfo = queuedUserInfo.shift();

    if (!userInfo) {
      throw new Error('No mocked OAuth userinfo queued for this call.');
    }

    return userInfo;
  });
  const getDiscoveryDocument = vi.fn(async (): Promise<OAuthDiscoveryDocument> => {
    return {
      issuer: process.env.DEEP_ID_ISSUER_URL as string,
      authorization_endpoint: 'https://identity.deep-id.ai/oauth2/auth',
      token_endpoint: 'https://identity.deep-id.ai/oauth2/token',
      userinfo_endpoint: 'https://identity.deep-id.ai/userinfo',
    };
  });
  const mockFns = [
    getScopes,
    buildAuthorizationUrl,
    exchangeCodeForTokens,
    refreshTokens,
    fetchUserInfo,
    getDiscoveryDocument,
  ];

  return {
    queueTokenResponse(tokenResponse) {
      queuedTokenResponses.push(tokenResponse);
    },
    queueUserInfo(userInfo) {
      queuedUserInfo.push(toOAuthUserInfo(userInfo));
    },
    reset() {
      queuedTokenResponses.splice(0);
      queuedUserInfo.splice(0);

      for (const mockFn of mockFns) {
        mockFn.mockClear();
      }
    },
    service: {
      getScopes,
      buildAuthorizationUrl,
      exchangeCodeForTokens,
      refreshTokens,
      fetchUserInfo,
      getDiscoveryDocument,
    },
  };
}

export async function seedAllowlist(
  accessAllowlistModel: Model<AccessAllowlist>,
  role: AccessRole,
  email: string,
  options: SeedAllowlistOptions = {},
): Promise<void> {
  const provider = options.provider ?? OAuthProviderDeepId;
  const normalizedEmail = email.trim().toLowerCase();
  const update = {
    $set: {
      provider,
      email: normalizedEmail,
      role,
      invitedBy: options.invitedBy ?? null,
      invitedAt: options.invitedAt ?? new Date(),
      ...(options.revokedAt ? { revokedAt: options.revokedAt, revokedBy: options.revokedBy ?? null } : {}),
    },
    ...(options.revokedAt ? {} : { $unset: { revokedAt: '', revokedBy: '' } }),
  };

  await accessAllowlistModel.updateOne(
    {
      provider,
      email: normalizedEmail,
    },
    update,
    { upsert: true },
  );
}

export async function loginAsMockedProvider(
  options: LoginAsMockedProviderOptions,
): Promise<LoginAsMockedProviderResult> {
  const agent = supertest.agent(options.app.getHttpServer());
  const code = options.code ?? `code-${options.sub.replace(/[^a-z0-9]+/giu, '-')}`;

  options.oauthProvider.queueUserInfo({
    email: options.email,
    emailVerified: options.emailVerified,
    sub: options.sub,
    username: options.username,
  });

  const loginResponse = await agent.get(base('/auth/deep-id/login')).expect(302);
  const state = new URL(loginResponse.headers.location).searchParams.get('state');

  if (!state) {
    throw new Error('Mock OAuth authorization redirect did not include state.');
  }

  const callbackResponse = await agent
    .get(base(`/auth/deep-id/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`))
    .expect(302);

  return {
    agent,
    callbackResponse,
    cookie: getSessionCookie(callbackResponse),
    loginResponse,
  };
}

export function requestAs(
  app: INestApplication,
  cookie: string | undefined,
  method: AuthenticatedRequestMethod,
  path: string,
  body?: AuthenticatedRequestBody,
): supertest.Test {
  const request = supertest(app.getHttpServer());
  let pendingRequest: supertest.Test;

  switch (method) {
    case 'delete':
      pendingRequest = request.delete(base(path));
      break;
    case 'get':
      pendingRequest = request.get(base(path));
      break;
    case 'post':
      pendingRequest = request.post(base(path));
      break;
  }

  pendingRequest.set('Accept', 'application/json');

  if (cookie) {
    pendingRequest.set('Cookie', cookie);
  }

  if (body !== undefined) {
    pendingRequest.send(body);
  }

  return pendingRequest;
}

export function getSessionCookie(response: supertest.Response): string | undefined {
  const setCookieHeader = response.headers['set-cookie'];
  const setCookies =
    typeof setCookieHeader === 'string' ? [setCookieHeader] : Array.isArray(setCookieHeader) ? setCookieHeader : [];
  const sessionCookie = setCookies.find((cookie) => cookie.startsWith(`${AUTH_TEST_ENV.AUTH_COOKIE_NAME}=`));

  return sessionCookie?.split(';')[0];
}

function toOAuthUserInfo(userInfo: MockOAuthUserInfoInput): OAuthUserInfo {
  return {
    aud: ['deep-id-test-client'],
    auth_time: 1775166617,
    email: userInfo.email,
    email_verified: userInfo.emailVerified,
    iat: 1775166619,
    iss: 'https://identity.deep-id.ai',
    rat: 1775166617,
    sub: userInfo.sub,
    username: userInfo.username ?? userInfo.email.split('@')[0],
  };
}
