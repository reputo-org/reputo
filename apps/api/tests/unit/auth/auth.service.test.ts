import { BadGatewayException, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../../src/auth/auth.service';
import { encryptValue } from '../../../src/shared/utils';
import { randomUUIDv7 } from '../../utils/uuid';

describe('AuthService', () => {
  let configValues: Record<string, unknown>;

  const oauthService = {
    getScopes: vi.fn(),
    buildAuthorizationUrl: vi.fn(),
    exchangeCodeForTokens: vi.fn(),
    refreshTokens: vi.fn(),
    fetchUserInfo: vi.fn(),
  };

  const cookieService = {
    getSessionId: vi.fn(),
    setSessionCookie: vi.fn(),
    clearSessionCookie: vi.fn(),
    setAuthFlowCookie: vi.fn(),
    getAuthFlow: vi.fn(),
    clearAuthFlowCookie: vi.fn(),
  };

  const authSessionRepository = {
    create: vi.fn(),
    findActiveBySessionId: vi.fn(),
    updateAfterRefresh: vi.fn(),
    revokeBySessionId: vi.fn(),
  };

  const oauthUserRepository = {
    upsertBySub: vi.fn(),
    findById: vi.fn(),
  };

  const accessService = {
    isAllowlisted: vi.fn(),
    resolveRole: vi.fn(),
  };

  let service: AuthService;

  function createService() {
    const configService = {
      get: vi.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;

    return new AuthService(
      oauthService as never,
      cookieService as never,
      authSessionRepository as never,
      oauthUserRepository as never,
      accessService as never,
      configService,
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    configValues = {
      'auth.mode': 'oauth',
      'auth.tokenEncryptionKey': '0123456789abcdef0123456789abcdef',
      'auth.sessionTtlSeconds': 3600,
      'auth.refreshLeewaySeconds': 60,
      'auth.appPublicUrl': 'http://localhost:5173',
    };
    oauthService.getScopes.mockReturnValue(['openid', 'profile', 'email', 'offline_access']);
    accessService.isAllowlisted.mockResolvedValue({
      _id: randomUUIDv7(),
      provider: 'deep-id',
      email: 'jane@example.com',
      role: 'owner',
      invitedAt: new Date('2026-04-01T00:00:00.000Z'),
    });
    accessService.resolveRole.mockResolvedValue('owner');
    service = createService();
  });

  it('creates auth flow state and delegates the OAuth login redirect', async () => {
    const request = { headers: { host: 'localhost:5173' } } as any;
    const response = {} as any;

    oauthService.buildAuthorizationUrl.mockResolvedValue('https://identity.deep-id.ai/oauth2/auth?state=abc');

    const redirectUrl = await service.getLoginRedirectUrl('deep-id', request, response);

    expect(redirectUrl).toBe('https://identity.deep-id.ai/oauth2/auth?state=abc');
    expect(oauthService.buildAuthorizationUrl).toHaveBeenCalledTimes(1);
    expect(cookieService.setAuthFlowCookie).toHaveBeenCalledTimes(1);
    expect(cookieService.setAuthFlowCookie).toHaveBeenCalledWith(
      response,
      expect.objectContaining({
        provider: 'deep-id',
        state: expect.any(String),
        codeVerifier: expect.any(String),
      }),
    );
    expect(cookieService.setAuthFlowCookie.mock.calls[0][1]).not.toHaveProperty('nonce');
  });

  it('creates a mock session during login without calling the OAuth provider', async () => {
    configValues['auth.mode'] = 'mock';
    configValues['auth.appPublicUrl'] = 'https://mock.invalid';
    service = createService();

    const userId = randomUUIDv7();
    const request = {
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'preview.reputo.dev',
      },
      secure: false,
    } as any;
    const response = {} as any;

    oauthUserRepository.upsertBySub.mockResolvedValue({
      _id: userId,
      provider: 'deep-id',
      sub: 'did:deep-id:mock-preview-user',
      email: 'preview@reputo.local',
      email_verified: true,
      username: 'preview-user',
      createdAt: new Date('2026-04-03T10:00:00.000Z'),
      updatedAt: new Date('2026-04-03T10:00:00.000Z'),
    });
    authSessionRepository.create.mockImplementation(async (payload) => ({
      _id: randomUUIDv7(),
      ...payload,
    }));

    const redirectUrl = await service.getLoginRedirectUrl('deep-id', request, response);

    expect(redirectUrl).toBe('https://preview.reputo.dev');
    expect(oauthService.buildAuthorizationUrl).not.toHaveBeenCalled();
    expect(oauthUserRepository.upsertBySub).toHaveBeenCalledWith('deep-id', 'did:deep-id:mock-preview-user', {
      email: 'preview@reputo.local',
      email_verified: true,
      username: 'preview-user',
    });
    expect(authSessionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'deep-id',
        userId,
        scope: ['openid', 'profile', 'email', 'offline_access'],
        state: expect.any(String),
        codeVerifier: expect.any(String),
      }),
    );
    expect(cookieService.setAuthFlowCookie).not.toHaveBeenCalled();
    expect(cookieService.setSessionCookie).toHaveBeenCalledTimes(1);
    expect(cookieService.clearAuthFlowCookie).not.toHaveBeenCalled();
  });

  it('handles the callback, syncs the user, creates the session, and issues the cookie', async () => {
    const response = {} as any;
    const request = { headers: {} } as any;
    const userId = randomUUIDv7();

    cookieService.getAuthFlow.mockReturnValue({
      provider: 'deep-id',
      state: 'state-123',
      codeVerifier: 'verifier-123',
    });
    oauthService.exchangeCodeForTokens.mockResolvedValue({
      access_token: 'provider-access-token',
      refresh_token: 'provider-refresh-token',
      expires_in: 300,
      refresh_token_expires_in: 1800,
      scope: 'openid profile email offline_access',
      token_type: 'Bearer',
    });
    oauthService.fetchUserInfo.mockResolvedValue({
      aud: ['deep-id-test-client'],
      auth_time: 1775166617,
      email: 'jane@example.com',
      email_verified: true,
      iat: 1775166619,
      iss: 'https://identity.staging.deep-id.ai',
      picture: 'https://example.com/avatar.png',
      rat: 1775166617,
      sub: 'did:deep-id:123',
      username: 'jane',
    });
    oauthUserRepository.upsertBySub.mockResolvedValue({
      _id: userId,
      provider: 'deep-id',
      sub: 'did:deep-id:123',
      aud: ['deep-id-test-client'],
      auth_time: 1775166617,
      email: 'jane@example.com',
      email_verified: true,
      iat: 1775166619,
      iss: 'https://identity.staging.deep-id.ai',
      picture: 'https://example.com/avatar.png',
      rat: 1775166617,
      username: 'jane',
      createdAt: new Date('2026-04-03T10:00:00.000Z'),
      updatedAt: new Date('2026-04-03T10:00:00.000Z'),
    });
    authSessionRepository.create.mockImplementation(async (payload) => ({
      _id: randomUUIDv7(),
      ...payload,
    }));

    const redirectUrl = await service.handleCallback(
      'deep-id',
      {
        code: 'code-123',
        state: 'state-123',
      },
      request,
      response,
    );

    expect(redirectUrl).toBe('http://localhost:5173');
    expect(oauthUserRepository.upsertBySub).toHaveBeenCalledWith(
      'deep-id',
      'did:deep-id:123',
      expect.objectContaining({
        aud: ['deep-id-test-client'],
        auth_time: 1775166617,
        email: 'jane@example.com',
        email_verified: true,
        picture: 'https://example.com/avatar.png',
        rat: 1775166617,
        username: 'jane',
      }),
    );
    expect(authSessionRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'deep-id',
        userId,
        accessTokenCiphertext: expect.any(String),
        refreshTokenCiphertext: expect.any(String),
        scope: ['openid', 'profile', 'email', 'offline_access'],
        state: 'state-123',
        codeVerifier: 'verifier-123',
      }),
    );
    expect(authSessionRepository.create.mock.calls[0][0]).not.toHaveProperty('nonce');
    expect(authSessionRepository.create.mock.calls[0][0].accessTokenCiphertext).not.toBe('provider-access-token');
    expect(authSessionRepository.create.mock.calls[0][0].refreshTokenCiphertext).not.toBe('provider-refresh-token');
    expect(cookieService.setSessionCookie).toHaveBeenCalledTimes(1);
    expect(cookieService.clearAuthFlowCookie).toHaveBeenCalledWith(response);
  });

  it('redirects to access denied without syncing a user when callback email is unverified', async () => {
    const loggerWarnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const response = {} as any;
    const request = { headers: {} } as any;

    cookieService.getAuthFlow.mockReturnValue({
      provider: 'deep-id',
      state: 'state-123',
      codeVerifier: 'verifier-123',
    });
    oauthService.exchangeCodeForTokens.mockResolvedValue({
      access_token: 'provider-access-token',
      refresh_token: 'provider-refresh-token',
      expires_in: 300,
      refresh_token_expires_in: 1800,
      scope: 'openid profile email offline_access',
      token_type: 'Bearer',
    });
    oauthService.fetchUserInfo.mockResolvedValue({
      email: '  Jane@Example.COM  ',
      email_verified: false,
      sub: 'did:deep-id:123',
      username: 'jane',
    });

    const redirectUrl = await service.handleCallback(
      'deep-id',
      {
        code: 'code-123',
        state: 'state-123',
      },
      request,
      response,
    );

    expect(redirectUrl).toBe('http://localhost:5173/access-denied?reason=email_unverified');
    expect(accessService.isAllowlisted).not.toHaveBeenCalled();
    expect(oauthUserRepository.upsertBySub).not.toHaveBeenCalled();
    expect(authSessionRepository.create).not.toHaveBeenCalled();
    expect(cookieService.setSessionCookie).not.toHaveBeenCalled();
    expect(cookieService.clearAuthFlowCookie).toHaveBeenCalledWith(response);
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'j***@example.com',
        sub: 'did:deep-id:123',
        reason: 'email_unverified',
      }),
    );

    loggerWarnSpy.mockRestore();
  });

  it('redirects to access denied without syncing a user when callback email is not allowlisted', async () => {
    const loggerWarnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const response = {} as any;
    const request = { headers: {} } as any;

    cookieService.getAuthFlow.mockReturnValue({
      provider: 'deep-id',
      state: 'state-123',
      codeVerifier: 'verifier-123',
    });
    oauthService.exchangeCodeForTokens.mockResolvedValue({
      access_token: 'provider-access-token',
      refresh_token: 'provider-refresh-token',
      expires_in: 300,
      refresh_token_expires_in: 1800,
      scope: 'openid profile email offline_access',
      token_type: 'Bearer',
    });
    oauthService.fetchUserInfo.mockResolvedValue({
      email: 'blocked@example.com',
      email_verified: true,
      sub: 'did:deep-id:blocked',
      username: 'blocked',
    });
    accessService.isAllowlisted.mockResolvedValue(null);

    const redirectUrl = await service.handleCallback(
      'deep-id',
      {
        code: 'code-123',
        state: 'state-123',
      },
      request,
      response,
    );

    expect(redirectUrl).toBe('http://localhost:5173/access-denied?reason=not_allowlisted');
    expect(accessService.isAllowlisted).toHaveBeenCalledWith('deep-id', 'blocked@example.com');
    expect(oauthUserRepository.upsertBySub).not.toHaveBeenCalled();
    expect(authSessionRepository.create).not.toHaveBeenCalled();
    expect(cookieService.setSessionCookie).not.toHaveBeenCalled();
    expect(cookieService.clearAuthFlowCookie).toHaveBeenCalledWith(response);
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'b***@example.com',
        sub: 'did:deep-id:blocked',
        reason: 'not_allowlisted',
      }),
    );

    loggerWarnSpy.mockRestore();
  });

  it('creates a mock session during callback without requiring Deep ID state', async () => {
    configValues['auth.mode'] = 'mock';
    configValues['auth.appPublicUrl'] = 'https://mock.invalid';
    service = createService();

    const userId = randomUUIDv7();
    const request = {
      headers: {
        host: 'preview.local',
      },
      secure: false,
    } as any;
    const response = {} as any;

    oauthUserRepository.upsertBySub.mockResolvedValue({
      _id: userId,
      provider: 'deep-id',
      sub: 'did:deep-id:mock-preview-user',
      email: 'preview@reputo.local',
      email_verified: true,
      username: 'preview-user',
      createdAt: new Date('2026-04-03T10:00:00.000Z'),
      updatedAt: new Date('2026-04-03T10:00:00.000Z'),
    });
    authSessionRepository.create.mockImplementation(async (payload) => ({
      _id: randomUUIDv7(),
      ...payload,
    }));

    const redirectUrl = await service.handleCallback('deep-id', {}, request, response);

    expect(redirectUrl).toBe('http://preview.local');
    expect(oauthService.exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(oauthService.fetchUserInfo).not.toHaveBeenCalled();
    expect(cookieService.setSessionCookie).toHaveBeenCalledTimes(1);
    expect(cookieService.clearAuthFlowCookie).toHaveBeenCalledWith(response);
  });

  it('rejects the callback when the state is mismatched and clears the transient flow cookie', async () => {
    const response = {} as any;
    const request = { headers: {} } as any;

    cookieService.getAuthFlow.mockReturnValue({
      provider: 'deep-id',
      state: 'expected-state',
      codeVerifier: 'verifier-123',
    });

    await expect(
      service.handleCallback(
        'deep-id',
        {
          code: 'code-123',
          state: 'wrong-state',
        },
        request,
        response,
      ),
    ).rejects.toThrow(UnauthorizedException);

    expect(authSessionRepository.create).not.toHaveBeenCalled();
    expect(cookieService.clearAuthFlowCookie).toHaveBeenCalledWith(response);
  });

  it('fails the callback when userinfo does not include sub', async () => {
    const response = {} as any;
    const request = { headers: {} } as any;

    cookieService.getAuthFlow.mockReturnValue({
      provider: 'deep-id',
      state: 'state-123',
      codeVerifier: 'verifier-123',
    });
    oauthService.exchangeCodeForTokens.mockResolvedValue({
      access_token: 'provider-access-token',
      refresh_token: 'provider-refresh-token',
      expires_in: 300,
      refresh_token_expires_in: 1800,
      scope: 'openid profile email offline_access',
      token_type: 'Bearer',
    });
    oauthService.fetchUserInfo.mockResolvedValue({
      email: 'jane@example.com',
      email_verified: true,
      username: 'jane',
    });

    await expect(
      service.handleCallback(
        'deep-id',
        {
          code: 'code-123',
          state: 'state-123',
        },
        request,
        response,
      ),
    ).rejects.toThrow(BadGatewayException);

    expect(authSessionRepository.create).not.toHaveBeenCalled();
    expect(cookieService.clearAuthFlowCookie).toHaveBeenCalledWith(response);
  });

  it('rejects and clears the cookie when the opaque session is missing', async () => {
    const response = {} as any;
    const request = { headers: {} } as any;

    cookieService.getSessionId.mockReturnValue('missing-session');
    authSessionRepository.findActiveBySessionId.mockResolvedValue(null);

    await expect(service.requireSession(request, response)).rejects.toThrow(UnauthorizedException);
    expect(cookieService.clearSessionCookie).toHaveBeenCalledWith(response);
  });

  it.each(['owner', 'admin'] as const)('attaches the resolved %s role to session context and views', async (role) => {
    const response = {} as any;
    const request = { headers: {} } as any;
    const userId = randomUUIDv7();

    cookieService.getSessionId.mockReturnValue(`session-${role}`);
    authSessionRepository.findActiveBySessionId.mockResolvedValue({
      _id: randomUUIDv7(),
      sessionId: `session-${role}`,
      provider: 'deep-id',
      userId,
      accessTokenCiphertext: encryptValue(configValues['auth.tokenEncryptionKey'] as string, 'provider-access-token'),
      refreshTokenCiphertext: encryptValue(configValues['auth.tokenEncryptionKey'] as string, 'provider-refresh-token'),
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      refreshTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      scope: ['openid', 'profile', 'email', 'offline_access'],
      state: 'state-123',
      codeVerifier: 'verifier-123',
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    });
    oauthUserRepository.findById.mockResolvedValue({
      _id: userId,
      provider: 'deep-id',
      sub: `did:deep-id:${role}`,
      email: `${role}@example.com`,
      email_verified: true,
      username: `${role}-user`,
      createdAt: new Date('2026-04-03T10:00:00.000Z'),
      updatedAt: new Date('2026-04-03T10:05:00.000Z'),
    });
    accessService.resolveRole.mockResolvedValue(role);

    const context = await service.requireSession(request, response);
    const view = service.toCurrentSessionView(context.session, context.user, context.role);

    expect(accessService.resolveRole).toHaveBeenCalledWith('deep-id', `${role}@example.com`);
    expect(context.role).toBe(role);
    expect(view).toMatchObject({
      authenticated: true,
      role,
      user: {
        role,
        sub: `did:deep-id:${role}`,
      },
    });
  });

  it('revokes the session, clears the cookie, and returns 401 when the allowlist row is missing mid-session', async () => {
    const response = {} as any;
    const request = { headers: {} } as any;
    const userId = randomUUIDv7();

    cookieService.getSessionId.mockReturnValue('session-revoked-allowlist');
    authSessionRepository.findActiveBySessionId.mockResolvedValue({
      _id: randomUUIDv7(),
      sessionId: 'session-revoked-allowlist',
      provider: 'deep-id',
      userId,
      accessTokenCiphertext: encryptValue(configValues['auth.tokenEncryptionKey'] as string, 'provider-access-token'),
      refreshTokenCiphertext: encryptValue(configValues['auth.tokenEncryptionKey'] as string, 'provider-refresh-token'),
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      refreshTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      scope: ['openid', 'profile', 'email', 'offline_access'],
      state: 'state-123',
      codeVerifier: 'verifier-123',
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    });
    oauthUserRepository.findById.mockResolvedValue({
      _id: userId,
      provider: 'deep-id',
      sub: 'did:deep-id:removed',
      email: 'removed@example.com',
      email_verified: true,
      username: 'removed',
      createdAt: new Date('2026-04-03T10:00:00.000Z'),
      updatedAt: new Date('2026-04-03T10:05:00.000Z'),
    });
    accessService.resolveRole.mockResolvedValue(null);

    await expect(service.requireSession(request, response)).rejects.toThrow(UnauthorizedException);

    expect(accessService.resolveRole).toHaveBeenCalledWith('deep-id', 'removed@example.com');
    expect(authSessionRepository.revokeBySessionId).toHaveBeenCalledWith('session-revoked-allowlist');
    expect(cookieService.clearSessionCookie).toHaveBeenCalledWith(response);
    expect(cookieService.setSessionCookie).not.toHaveBeenCalled();
  });

  it('returns the current mock session payload during bootstrap', async () => {
    configValues['auth.mode'] = 'mock';
    service = createService();

    const response = {} as any;
    const request = { headers: {} } as any;
    const userId = randomUUIDv7();

    cookieService.getSessionId.mockReturnValue('mock-session');
    authSessionRepository.findActiveBySessionId.mockResolvedValue({
      _id: randomUUIDv7(),
      sessionId: 'mock-session',
      provider: 'deep-id',
      userId,
      accessTokenCiphertext: encryptValue(configValues['auth.tokenEncryptionKey'] as string, 'mock-access-token'),
      refreshTokenCiphertext: encryptValue(configValues['auth.tokenEncryptionKey'] as string, 'mock-refresh-token'),
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      refreshTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      scope: ['openid', 'profile', 'email', 'offline_access'],
      state: 'mock-state',
      codeVerifier: 'mock-verifier',
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    });
    oauthUserRepository.findById.mockResolvedValue({
      _id: userId,
      provider: 'deep-id',
      sub: 'did:deep-id:mock-preview-user',
      email: 'preview@reputo.local',
      email_verified: true,
      username: 'preview-user',
      createdAt: new Date('2026-04-03T10:00:00.000Z'),
      updatedAt: new Date('2026-04-03T10:05:00.000Z'),
    });

    const context = await service.requireSession(request, response);
    const currentSession = service.toCurrentSessionView(context.session, context.user, context.role);

    expect(currentSession).toMatchObject({
      authenticated: true,
      provider: 'deep-id',
      role: 'owner',
      scope: ['openid', 'profile', 'email', 'offline_access'],
      user: {
        provider: 'deep-id',
        role: 'owner',
        sub: 'did:deep-id:mock-preview-user',
        email: 'preview@reputo.local',
        username: 'preview-user',
      },
    });
    expect(accessService.resolveRole).not.toHaveBeenCalled();
  });

  it('refreshes near-expiry provider tokens during session bootstrap', async () => {
    const response = {} as any;
    const request = { headers: {} } as any;
    const userId = randomUUIDv7();
    const encryptedRefreshToken = encryptValue(
      configValues['auth.tokenEncryptionKey'] as string,
      'provider-refresh-token',
    );

    cookieService.getSessionId.mockReturnValue('session-123');
    authSessionRepository.findActiveBySessionId.mockResolvedValue({
      _id: randomUUIDv7(),
      sessionId: 'session-123',
      provider: 'deep-id',
      userId,
      accessTokenCiphertext: encryptValue(configValues['auth.tokenEncryptionKey'] as string, 'old-access-token'),
      refreshTokenCiphertext: encryptedRefreshToken,
      accessTokenExpiresAt: new Date(Date.now() - 1_000),
      refreshTokenExpiresAt: new Date(Date.now() + 10 * 60 * 1_000),
      scope: ['openid', 'profile'],
      state: 'state-123',
      codeVerifier: 'verifier-123',
      expiresAt: new Date(Date.now() + 30 * 60 * 1_000),
    });
    oauthService.refreshTokens.mockResolvedValue({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 300,
      refresh_token_expires_in: 600,
      scope: 'openid profile email offline_access',
      token_type: 'Bearer',
    });
    authSessionRepository.updateAfterRefresh.mockImplementation(async (_sessionId, payload) => ({
      _id: randomUUIDv7(),
      sessionId: 'session-123',
      provider: 'deep-id',
      userId,
      state: 'state-123',
      codeVerifier: 'verifier-123',
      ...payload,
    }));
    oauthService.fetchUserInfo.mockResolvedValue({
      aud: ['deep-id-test-client'],
      auth_time: 1775166617,
      email: 'jane@example.com',
      email_verified: true,
      iat: 1775166619,
      iss: 'https://identity.staging.deep-id.ai',
      picture: 'https://example.com/avatar.png',
      rat: 1775166617,
      sub: 'did:deep-id:123',
      username: 'jane',
    });
    oauthUserRepository.upsertBySub.mockResolvedValue({
      _id: userId,
      provider: 'deep-id',
      sub: 'did:deep-id:123',
      email: 'jane@example.com',
      email_verified: true,
      username: 'jane',
      picture: 'https://example.com/avatar.png',
    });
    oauthUserRepository.findById.mockResolvedValue({
      _id: userId,
      provider: 'deep-id',
      sub: 'did:deep-id:123',
      aud: ['deep-id-test-client'],
      auth_time: 1775166617,
      email: 'jane@example.com',
      email_verified: true,
      iat: 1775166619,
      iss: 'https://identity.staging.deep-id.ai',
      picture: 'https://example.com/avatar.png',
      rat: 1775166617,
      username: 'jane',
      createdAt: new Date('2026-04-03T10:00:00.000Z'),
      updatedAt: new Date('2026-04-03T10:05:00.000Z'),
    });

    const context = await service.requireSession(request, response);
    const currentSession = service.toCurrentSessionView(context.session, context.user, context.role);

    expect(oauthService.refreshTokens).toHaveBeenCalledWith('deep-id', 'provider-refresh-token');
    expect(authSessionRepository.updateAfterRefresh).toHaveBeenCalledTimes(1);
    expect(oauthUserRepository.upsertBySub).toHaveBeenCalledWith(
      'deep-id',
      'did:deep-id:123',
      expect.objectContaining({
        email: 'jane@example.com',
        username: 'jane',
      }),
    );
    expect(currentSession).toMatchObject({
      authenticated: true,
      provider: 'deep-id',
      user: {
        provider: 'deep-id',
        sub: 'did:deep-id:123',
        email: 'jane@example.com',
        username: 'jane',
      },
    });
  });

  it('preserves the session when the provider refresh fails transiently', async () => {
    const response = {} as any;
    const request = { headers: {} } as any;
    const userId = randomUUIDv7();
    const refreshTokenCiphertext = encryptValue(
      configValues['auth.tokenEncryptionKey'] as string,
      'provider-refresh-token',
    );
    const sessionRow = {
      _id: randomUUIDv7(),
      sessionId: 'session-transient',
      provider: 'deep-id',
      userId,
      accessTokenCiphertext: encryptValue(configValues['auth.tokenEncryptionKey'] as string, 'old-access-token'),
      refreshTokenCiphertext,
      accessTokenExpiresAt: new Date(Date.now() - 1_000),
      refreshTokenExpiresAt: new Date(Date.now() + 10 * 60 * 1_000),
      scope: ['openid', 'profile'],
      state: 'state-123',
      codeVerifier: 'verifier-123',
      expiresAt: new Date(Date.now() + 30 * 60 * 1_000),
    };

    cookieService.getSessionId.mockReturnValue('session-transient');
    authSessionRepository.findActiveBySessionId.mockResolvedValue(sessionRow);
    oauthService.refreshTokens.mockRejectedValue(new BadGatewayException('upstream is down'));
    oauthUserRepository.findById.mockResolvedValue({
      _id: userId,
      provider: 'deep-id',
      sub: 'did:deep-id:123',
      email: 'jane@example.com',
      email_verified: true,
      username: 'jane',
      createdAt: new Date('2026-04-03T10:00:00.000Z'),
      updatedAt: new Date('2026-04-03T10:00:00.000Z'),
    });
    const loggerWarnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const context = await service.requireSession(request, response);

    expect(context.session.sessionId).toBe('session-transient');
    expect(authSessionRepository.updateAfterRefresh).not.toHaveBeenCalled();
    expect(authSessionRepository.revokeBySessionId).not.toHaveBeenCalled();
    expect(cookieService.clearSessionCookie).not.toHaveBeenCalled();
    expect(cookieService.setSessionCookie).toHaveBeenCalledTimes(1);
    expect(loggerWarnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-transient',
        provider: 'deep-id',
      }),
    );

    loggerWarnSpy.mockRestore();
  });

  it('revokes the session when the provider rejects the refresh token with invalid_grant', async () => {
    const response = {} as any;
    const request = { headers: {} } as any;
    const userId = randomUUIDv7();
    const refreshTokenCiphertext = encryptValue(
      configValues['auth.tokenEncryptionKey'] as string,
      'provider-refresh-token',
    );

    cookieService.getSessionId.mockReturnValue('session-invalid-grant');
    authSessionRepository.findActiveBySessionId.mockResolvedValueOnce({
      _id: randomUUIDv7(),
      sessionId: 'session-invalid-grant',
      provider: 'deep-id',
      userId,
      accessTokenCiphertext: encryptValue(configValues['auth.tokenEncryptionKey'] as string, 'old-access-token'),
      refreshTokenCiphertext,
      accessTokenExpiresAt: new Date(Date.now() - 1_000),
      refreshTokenExpiresAt: new Date(Date.now() + 10 * 60 * 1_000),
      scope: ['openid', 'profile'],
      state: 'state-123',
      codeVerifier: 'verifier-123',
      expiresAt: new Date(Date.now() + 30 * 60 * 1_000),
      lastRefreshedAt: new Date(Date.now() - 60 * 1_000),
    });
    authSessionRepository.findActiveBySessionId.mockResolvedValueOnce({
      _id: randomUUIDv7(),
      sessionId: 'session-invalid-grant',
      provider: 'deep-id',
      userId,
      accessTokenCiphertext: encryptValue(configValues['auth.tokenEncryptionKey'] as string, 'old-access-token'),
      refreshTokenCiphertext,
      accessTokenExpiresAt: new Date(Date.now() - 1_000),
      refreshTokenExpiresAt: new Date(Date.now() + 10 * 60 * 1_000),
      scope: ['openid', 'profile'],
      state: 'state-123',
      codeVerifier: 'verifier-123',
      expiresAt: new Date(Date.now() + 30 * 60 * 1_000),
      lastRefreshedAt: new Date(Date.now() - 60 * 1_000),
    });
    oauthService.refreshTokens.mockRejectedValue(new UnauthorizedException('invalid_grant'));

    await expect(service.requireSession(request, response)).rejects.toThrow(UnauthorizedException);

    expect(authSessionRepository.revokeBySessionId).toHaveBeenCalledWith('session-invalid-grant');
    expect(cookieService.clearSessionCookie).toHaveBeenCalledWith(response);
  });

  it('adopts a peer-refreshed session when invalid_grant follows a remote rotation', async () => {
    const response = {} as any;
    const request = { headers: {} } as any;
    const userId = randomUUIDv7();
    const stalelastRefreshedAt = new Date(Date.now() - 60 * 1_000);
    const freshLastRefreshedAt = new Date(Date.now() - 1_000);

    cookieService.getSessionId.mockReturnValue('session-peer-rotated');
    authSessionRepository.findActiveBySessionId.mockResolvedValueOnce({
      _id: randomUUIDv7(),
      sessionId: 'session-peer-rotated',
      provider: 'deep-id',
      userId,
      accessTokenCiphertext: encryptValue(configValues['auth.tokenEncryptionKey'] as string, 'old-access-token'),
      refreshTokenCiphertext: encryptValue(configValues['auth.tokenEncryptionKey'] as string, 'old-refresh-token'),
      accessTokenExpiresAt: new Date(Date.now() - 1_000),
      refreshTokenExpiresAt: new Date(Date.now() + 10 * 60 * 1_000),
      scope: ['openid', 'profile'],
      state: 'state-123',
      codeVerifier: 'verifier-123',
      expiresAt: new Date(Date.now() + 30 * 60 * 1_000),
      lastRefreshedAt: stalelastRefreshedAt,
    });
    authSessionRepository.findActiveBySessionId.mockResolvedValueOnce({
      _id: randomUUIDv7(),
      sessionId: 'session-peer-rotated',
      provider: 'deep-id',
      userId,
      accessTokenCiphertext: encryptValue(configValues['auth.tokenEncryptionKey'] as string, 'peer-access-token'),
      refreshTokenCiphertext: encryptValue(configValues['auth.tokenEncryptionKey'] as string, 'peer-refresh-token'),
      accessTokenExpiresAt: new Date(Date.now() + 5 * 60 * 1_000),
      refreshTokenExpiresAt: new Date(Date.now() + 10 * 60 * 1_000),
      scope: ['openid', 'profile'],
      state: 'state-123',
      codeVerifier: 'verifier-123',
      expiresAt: new Date(Date.now() + 30 * 60 * 1_000),
      lastRefreshedAt: freshLastRefreshedAt,
    });
    oauthService.refreshTokens.mockRejectedValue(new UnauthorizedException('invalid_grant'));
    oauthUserRepository.findById.mockResolvedValue({
      _id: userId,
      provider: 'deep-id',
      sub: 'did:deep-id:123',
      email: 'jane@example.com',
      email_verified: true,
      username: 'jane',
      createdAt: new Date('2026-04-03T10:00:00.000Z'),
      updatedAt: new Date('2026-04-03T10:00:00.000Z'),
    });

    const context = await service.requireSession(request, response);

    expect(context.session.sessionId).toBe('session-peer-rotated');
    expect(authSessionRepository.revokeBySessionId).not.toHaveBeenCalled();
    expect(cookieService.clearSessionCookie).not.toHaveBeenCalled();
    expect(cookieService.setSessionCookie).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent refreshes so the provider is only called once per session', async () => {
    const response = {} as any;
    const request = { headers: {} } as any;
    const userId = randomUUIDv7();
    const sessionRow = {
      _id: randomUUIDv7(),
      sessionId: 'session-coalesce',
      provider: 'deep-id',
      userId,
      accessTokenCiphertext: encryptValue(configValues['auth.tokenEncryptionKey'] as string, 'old-access-token'),
      refreshTokenCiphertext: encryptValue(configValues['auth.tokenEncryptionKey'] as string, 'provider-refresh-token'),
      accessTokenExpiresAt: new Date(Date.now() - 1_000),
      refreshTokenExpiresAt: new Date(Date.now() + 10 * 60 * 1_000),
      scope: ['openid', 'profile'],
      state: 'state-123',
      codeVerifier: 'verifier-123',
      expiresAt: new Date(Date.now() + 30 * 60 * 1_000),
    };

    cookieService.getSessionId.mockReturnValue('session-coalesce');
    authSessionRepository.findActiveBySessionId.mockResolvedValue(sessionRow);

    let resolveRefresh: (value: unknown) => void = () => undefined;
    const refreshPromise = new Promise((resolve) => {
      resolveRefresh = resolve;
    });
    oauthService.refreshTokens.mockReturnValue(refreshPromise);
    authSessionRepository.updateAfterRefresh.mockImplementation(async (_sessionId, payload) => ({
      _id: randomUUIDv7(),
      sessionId: 'session-coalesce',
      provider: 'deep-id',
      userId,
      state: 'state-123',
      codeVerifier: 'verifier-123',
      ...payload,
    }));
    oauthService.fetchUserInfo.mockResolvedValue({
      sub: 'did:deep-id:123',
      email: 'jane@example.com',
      email_verified: true,
      username: 'jane',
    });
    oauthUserRepository.upsertBySub.mockResolvedValue({
      _id: userId,
      provider: 'deep-id',
      sub: 'did:deep-id:123',
      email: 'jane@example.com',
      email_verified: true,
      username: 'jane',
    });
    oauthUserRepository.findById.mockResolvedValue({
      _id: userId,
      provider: 'deep-id',
      sub: 'did:deep-id:123',
      email: 'jane@example.com',
      email_verified: true,
      username: 'jane',
    });

    const first = service.requireSession(request, response);
    const second = service.requireSession(request, response);

    resolveRefresh({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 300,
      refresh_token_expires_in: 600,
      scope: 'openid profile',
      token_type: 'Bearer',
    });

    await Promise.all([first, second]);

    expect(oauthService.refreshTokens).toHaveBeenCalledTimes(1);
    expect(authSessionRepository.updateAfterRefresh).toHaveBeenCalledTimes(1);
  });

  it('revokes the current session and clears cookies during logout', async () => {
    const response = {} as any;

    await service.logout(
      {
        sessionId: 'session-123',
      } as any,
      response,
    );

    expect(authSessionRepository.revokeBySessionId).toHaveBeenCalledWith('session-123');
    expect(cookieService.clearSessionCookie).toHaveBeenCalledWith(response);
    expect(cookieService.clearAuthFlowCookie).toHaveBeenCalledWith(response);
  });
});
