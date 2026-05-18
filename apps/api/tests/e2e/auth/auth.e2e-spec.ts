import type { INestApplication } from '@nestjs/common';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { AccessAllowlist, AccessRole, AuthSession, OAuthUser } from '@reputo/database';
import { MODEL_NAMES } from '@reputo/database';
import type { Model } from 'mongoose';
import { LoggerModule } from 'nestjs-pino';
import supertest from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthModule } from '../../../src/auth';
import { OAuthAuthProviderService } from '../../../src/auth/oauth-auth-provider.service';
import { configModules } from '../../../src/config';
import { HttpExceptionFilter } from '../../../src/shared/filters/http-exception.filter';
import { AUTH_TEST_ENV, applyAuthTestEnv } from '../../utils/auth-session';
import { startMongo, stopMongo } from '../../utils/mongo-memory-server';
import { base } from '../../utils/request';

describe('OAuth auth e2e', () => {
  let app: INestApplication;
  let accessAllowlistModel: Model<AccessAllowlist>;
  let authSessionModel: Model<AuthSession>;
  let oauthUserModel: Model<OAuthUser>;

  const mockOAuthService = {
    getScopes: vi.fn(() => ['openid', 'profile', 'email', 'offline_access']),
    buildAuthorizationUrl: vi.fn(async (_provider: string, flow: { state: string }) => {
      const url = new URL('https://identity.deep-id.ai/oauth2/auth');
      url.searchParams.set('state', flow.state);
      return url.toString();
    }),
    exchangeCodeForTokens: vi.fn(),
    refreshTokens: vi.fn(),
    fetchUserInfo: vi.fn(),
    getDiscoveryDocument: vi.fn(),
  };

  beforeAll(async () => {
    applyAuthTestEnv();

    const mongoUri = await startMongo();

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          load: configModules,
          isGlobal: true,
          ignoreEnvFile: true,
        }),
        LoggerModule.forRoot({
          pinoHttp: {
            level: 'silent',
          },
        }),
        MongooseModule.forRoot(mongoUri),
        AuthModule,
      ],
    })
      .overrideProvider(OAuthAuthProviderService)
      .useValue(mockOAuthService)
      .compile();

    authSessionModel = moduleRef.get(getModelToken(MODEL_NAMES.AUTH_SESSION));
    oauthUserModel = moduleRef.get(getModelToken(MODEL_NAMES.OAUTH_USER));
    accessAllowlistModel = moduleRef.get(getModelToken(MODEL_NAMES.ACCESS_ALLOWLIST));
    app = moduleRef.createNestApplication();

    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
      prefix: 'api/v',
    });

    await app.init();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all([
      authSessionModel.deleteMany({}),
      oauthUserModel.deleteMany({}),
      accessAllowlistModel.deleteMany({ email: { $ne: AUTH_TEST_ENV.OWNER_EMAIL } }),
      accessAllowlistModel.updateOne(
        {
          provider: 'deep-id',
          email: AUTH_TEST_ENV.OWNER_EMAIL,
        },
        {
          $set: {
            provider: 'deep-id',
            email: AUTH_TEST_ENV.OWNER_EMAIL,
            role: 'owner',
            invitedBy: null,
          },
          $setOnInsert: {
            invitedAt: new Date(),
          },
          $unset: {
            revokedAt: '',
            revokedBy: '',
          },
        },
        { upsert: true },
      ),
    ]);
  });

  afterAll(async () => {
    await app.close();
    await stopMongo();
  });

  async function allowlistEmail(email: string, role: AccessRole = 'admin'): Promise<void> {
    const normalizedEmail = email.trim().toLowerCase();

    await accessAllowlistModel.updateOne(
      {
        provider: 'deep-id',
        email: normalizedEmail,
      },
      {
        $set: {
          provider: 'deep-id',
          email: normalizedEmail,
          role,
          invitedBy: null,
        },
        $setOnInsert: {
          invitedAt: new Date(),
        },
        $unset: {
          revokedAt: '',
          revokedBy: '',
        },
      },
      { upsert: true },
    );
  }

  it('starts the login flow and redirects to Deep ID', async () => {
    const agent = supertest.agent(app.getHttpServer());

    const response = await agent.get(base('/auth/deep-id/login')).expect(302);
    const redirectUrl = new URL(response.headers.location);

    expect(redirectUrl.origin).toBe('https://identity.deep-id.ai');
    expect(redirectUrl.pathname).toBe('/oauth2/auth');
    expect(redirectUrl.searchParams.get('state')).toBeTruthy();
    expect(redirectUrl.searchParams.get('nonce')).toBeNull();
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining(`${AUTH_TEST_ENV.AUTH_COOKIE_NAME}.flow=`)]),
    );
  });

  it('requires a session for /me and /logout', async () => {
    const agent = supertest.agent(app.getHttpServer());

    const currentSession = await agent.get(base('/auth/me')).expect(401);
    const logoutResponse = await agent.post(base('/auth/logout')).expect(401);

    expect(currentSession.body).toMatchObject({
      statusCode: 401,
      path: base('/auth/me'),
    });
    expect(logoutResponse.body).toMatchObject({
      statusCode: 401,
      path: base('/auth/logout'),
    });
  });

  it('completes the callback flow, syncs the full userinfo payload, creates the session, and bootstraps /me', async () => {
    const agent = supertest.agent(app.getHttpServer());

    mockOAuthService.exchangeCodeForTokens.mockResolvedValue({
      access_token: 'provider-access-token',
      refresh_token: 'provider-refresh-token',
      expires_in: 300,
      refresh_token_expires_in: 1800,
      token_type: 'Bearer',
      scope: 'openid profile email offline_access',
    });
    mockOAuthService.fetchUserInfo.mockResolvedValue({
      aud: ['9cad9abe-1dc6-4c66-acac-f747026c3beb'],
      auth_time: 1775166617,
      email: 'behzad.rabiei.77@gmail.com',
      email_verified: true,
      iat: 1775166619,
      iss: 'https://identity.staging.deep-id.ai',
      picture:
        'https://staging-deep-sso-uploads.s3.eu-west-2.amazonaws.com/profiles/5fc64381-e62a-408a-914b-2bac26983d86/1775155696375-0ke0pgb.behzadrabiei77_avatar',
      rat: 1775166617,
      sub: 'did:plc:pwtlzekayxk67odbhen6v2bb',
      username: 'behzad',
    });

    const loginResponse = await agent.get(base('/auth/deep-id/login')).expect(302);
    const state = new URL(loginResponse.headers.location).searchParams.get('state');

    expect(state).toBeTruthy();

    const callbackResponse = await agent.get(base(`/auth/deep-id/callback?code=code-123&state=${state}`)).expect(302);

    expect(callbackResponse.headers.location).toBe(AUTH_TEST_ENV.APP_PUBLIC_URL);
    expect(callbackResponse.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining(`${AUTH_TEST_ENV.AUTH_COOKIE_NAME}=`)]),
    );

    const storedUser = await oauthUserModel.findOne({ sub: 'did:plc:pwtlzekayxk67odbhen6v2bb' }).lean();
    const storedSession = await authSessionModel
      .findOne({})
      .select('+accessTokenCiphertext +refreshTokenCiphertext +state +codeVerifier')
      .lean();

    expect(storedUser).toMatchObject({
      provider: 'deep-id',
      sub: 'did:plc:pwtlzekayxk67odbhen6v2bb',
      aud: ['9cad9abe-1dc6-4c66-acac-f747026c3beb'],
      auth_time: 1775166617,
      email: 'behzad.rabiei.77@gmail.com',
      email_verified: true,
      iat: 1775166619,
      iss: 'https://identity.staging.deep-id.ai',
      picture:
        'https://staging-deep-sso-uploads.s3.eu-west-2.amazonaws.com/profiles/5fc64381-e62a-408a-914b-2bac26983d86/1775155696375-0ke0pgb.behzadrabiei77_avatar',
      rat: 1775166617,
      username: 'behzad',
    });
    expect(storedUser).not.toHaveProperty('did');
    expect(storedSession).toBeTruthy();
    expect(storedSession?.accessTokenCiphertext).not.toBe('provider-access-token');
    expect(storedSession?.refreshTokenCiphertext).not.toBe('provider-refresh-token');
    expect(storedSession?.state).toBe(state);
    expect(storedSession?.codeVerifier).toBeTruthy();
    expect(storedSession).not.toHaveProperty('nonce');

    const currentSession = await agent.get(base('/auth/me')).expect(200);

    expect(currentSession.body).toMatchObject({
      authenticated: true,
      provider: 'deep-id',
      role: 'owner',
      scope: ['openid', 'profile', 'email', 'offline_access'],
      user: {
        provider: 'deep-id',
        role: 'owner',
        sub: 'did:plc:pwtlzekayxk67odbhen6v2bb',
        aud: ['9cad9abe-1dc6-4c66-acac-f747026c3beb'],
        auth_time: 1775166617,
        email: 'behzad.rabiei.77@gmail.com',
        email_verified: true,
        iat: 1775166619,
        iss: 'https://identity.staging.deep-id.ai',
        picture:
          'https://staging-deep-sso-uploads.s3.eu-west-2.amazonaws.com/profiles/5fc64381-e62a-408a-914b-2bac26983d86/1775155696375-0ke0pgb.behzadrabiei77_avatar',
        rat: 1775166617,
        username: 'behzad',
      },
    });
  });

  it('rejects the callback when the state does not match the stored auth flow', async () => {
    const agent = supertest.agent(app.getHttpServer());

    await agent.get(base('/auth/deep-id/login')).expect(302);

    await agent.get(base('/auth/deep-id/callback?code=code-123&state=wrong-state')).expect(401);

    expect(await authSessionModel.countDocuments()).toBe(0);
  });

  it('redirects to access-denied with consent_denied when the provider returns access_denied', async () => {
    const agent = supertest.agent(app.getHttpServer());

    await agent.get(base('/auth/deep-id/login')).expect(302);

    const callbackResponse = await agent
      .get(
        base(
          '/auth/deep-id/callback?error=access_denied&error_description=The+resource+owner+denied+the+request&state=anything',
        ),
      )
      .expect(302);

    expect(callbackResponse.headers.location).toBe(
      `${AUTH_TEST_ENV.APP_PUBLIC_URL}/access-denied?reason=consent_denied`,
    );
    expect(callbackResponse.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining(`${AUTH_TEST_ENV.AUTH_COOKIE_NAME}.flow=;`)]),
    );
    expect(await oauthUserModel.countDocuments()).toBe(0);
    expect(await authSessionModel.countDocuments()).toBe(0);
  });

  it('redirects unverified callback email to access denied without creating a user or session', async () => {
    const agent = supertest.agent(app.getHttpServer());

    mockOAuthService.exchangeCodeForTokens.mockResolvedValue({
      access_token: 'provider-access-token',
      refresh_token: 'provider-refresh-token',
      expires_in: 300,
      refresh_token_expires_in: 1800,
      token_type: 'Bearer',
      scope: 'openid profile email offline_access',
    });
    mockOAuthService.fetchUserInfo.mockResolvedValue({
      email: 'unverified@example.com',
      email_verified: false,
      sub: 'did:deep-id:unverified',
      username: 'unverified',
    });

    const loginResponse = await agent.get(base('/auth/deep-id/login')).expect(302);
    const state = new URL(loginResponse.headers.location).searchParams.get('state');
    const callbackResponse = await agent
      .get(base(`/auth/deep-id/callback?code=code-unverified&state=${state}`))
      .expect(302);

    expect(callbackResponse.headers.location).toBe(
      `${AUTH_TEST_ENV.APP_PUBLIC_URL}/access-denied?reason=email_unverified`,
    );
    expect(callbackResponse.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining(`${AUTH_TEST_ENV.AUTH_COOKIE_NAME}.flow=;`)]),
    );
    expect(await oauthUserModel.countDocuments()).toBe(0);
    expect(await authSessionModel.countDocuments()).toBe(0);
  });

  it('treats a revoked allowlist row as not allowlisted during callback', async () => {
    const agent = supertest.agent(app.getHttpServer());

    await accessAllowlistModel.create({
      provider: 'deep-id',
      email: 'revoked@example.com',
      role: 'admin',
      invitedBy: null,
      invitedAt: new Date('2026-04-01T00:00:00.000Z'),
      revokedAt: new Date('2026-04-02T00:00:00.000Z'),
    });
    mockOAuthService.exchangeCodeForTokens.mockResolvedValue({
      access_token: 'provider-access-token',
      refresh_token: 'provider-refresh-token',
      expires_in: 300,
      refresh_token_expires_in: 1800,
      token_type: 'Bearer',
      scope: 'openid profile email offline_access',
    });
    mockOAuthService.fetchUserInfo.mockResolvedValue({
      email: 'revoked@example.com',
      email_verified: true,
      sub: 'did:deep-id:revoked',
      username: 'revoked',
    });

    const loginResponse = await agent.get(base('/auth/deep-id/login')).expect(302);
    const state = new URL(loginResponse.headers.location).searchParams.get('state');
    const callbackResponse = await agent
      .get(base(`/auth/deep-id/callback?code=code-revoked&state=${state}`))
      .expect(302);

    expect(callbackResponse.headers.location).toBe(
      `${AUTH_TEST_ENV.APP_PUBLIC_URL}/access-denied?reason=not_allowlisted`,
    );
    expect(await oauthUserModel.countDocuments()).toBe(0);
    expect(await authSessionModel.countDocuments()).toBe(0);
  });

  it('refreshes provider tokens during /me when the stored access token is close to expiry', async () => {
    const agent = supertest.agent(app.getHttpServer());

    await allowlistEmail('refresh@example.com');

    mockOAuthService.exchangeCodeForTokens.mockResolvedValue({
      access_token: 'stale-access-token',
      refresh_token: 'stale-refresh-token',
      expires_in: 5,
      refresh_token_expires_in: 1800,
      token_type: 'Bearer',
      scope: 'openid profile email offline_access',
    });
    mockOAuthService.fetchUserInfo.mockResolvedValue({
      aud: ['deep-id-test-client'],
      auth_time: 1775166617,
      email: 'refresh@example.com',
      email_verified: true,
      iat: 1775166619,
      iss: 'https://identity.staging.deep-id.ai',
      picture: 'https://example.com/refresh.png',
      rat: 1775166617,
      sub: 'did:deep-id:refresh',
      username: 'refresh-user',
    });

    const loginResponse = await agent.get(base('/auth/deep-id/login')).expect(302);
    const state = new URL(loginResponse.headers.location).searchParams.get('state');

    await agent.get(base(`/auth/deep-id/callback?code=code-refresh&state=${state}`)).expect(302);

    const storedSession = await authSessionModel.findOne({}).lean();
    expect(storedSession).toBeTruthy();

    await authSessionModel.updateOne(
      { _id: storedSession?._id },
      {
        accessTokenExpiresAt: new Date(Date.now() - 1_000),
      },
    );

    mockOAuthService.refreshTokens.mockResolvedValue({
      access_token: 'fresh-access-token',
      refresh_token: 'fresh-refresh-token',
      expires_in: 300,
      refresh_token_expires_in: 1700,
      token_type: 'Bearer',
      scope: 'openid profile email offline_access',
    });

    const response = await agent.get(base('/auth/me')).expect(200);
    const refreshedSession = await authSessionModel
      .findOne({})
      .select('+accessTokenCiphertext +refreshTokenCiphertext')
      .lean();

    expect(response.body.authenticated).toBe(true);
    expect(response.body.user).toMatchObject({
      sub: 'did:deep-id:refresh',
      username: 'refresh-user',
    });
    expect(mockOAuthService.refreshTokens).toHaveBeenCalledTimes(1);
    expect(refreshedSession?.accessTokenCiphertext).not.toBe('fresh-access-token');
    expect(refreshedSession?.refreshTokenCiphertext).not.toBe('fresh-refresh-token');
  });

  it('logs out by clearing the cookie and revoking the stored session', async () => {
    const agent = supertest.agent(app.getHttpServer());

    await allowlistEmail('logout@example.com');

    mockOAuthService.exchangeCodeForTokens.mockResolvedValue({
      access_token: 'provider-access-token',
      refresh_token: 'provider-refresh-token',
      expires_in: 300,
      refresh_token_expires_in: 1800,
      token_type: 'Bearer',
      scope: 'openid profile email offline_access',
    });
    mockOAuthService.fetchUserInfo.mockResolvedValue({
      aud: ['deep-id-test-client'],
      auth_time: 1775166617,
      email: 'logout@example.com',
      email_verified: true,
      iat: 1775166619,
      iss: 'https://identity.staging.deep-id.ai',
      picture: 'https://example.com/logout.png',
      rat: 1775166617,
      sub: 'did:deep-id:logout',
      username: 'logout-user',
    });

    const loginResponse = await agent.get(base('/auth/deep-id/login')).expect(302);
    const state = new URL(loginResponse.headers.location).searchParams.get('state');

    await agent.get(base(`/auth/deep-id/callback?code=code-logout&state=${state}`)).expect(302);

    const activeSession = await authSessionModel.findOne({}).lean();

    expect(activeSession).toBeTruthy();

    const logoutResponse = await agent.post(base('/auth/logout')).expect(204);

    expect(logoutResponse.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining(`${AUTH_TEST_ENV.AUTH_COOKIE_NAME}=;`)]),
    );

    const revokedSession = await authSessionModel.findById(activeSession?._id).lean();
    const currentSession = await agent.get(base('/auth/me')).expect(401);

    expect(revokedSession?.revokedAt).toBeTruthy();
    expect(currentSession.body).toMatchObject({
      statusCode: 401,
      path: base('/auth/me'),
    });
  });
});
