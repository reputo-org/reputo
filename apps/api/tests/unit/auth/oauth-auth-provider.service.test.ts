import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { OAuthAuthProviderService } from '../../../src/auth/oauth-auth-provider.service';
import type { OAuthProviderClient } from '../../../src/shared/oauth';

describe('OAuthAuthProviderService', () => {
  const providerConfig = {
    issuerUrl: 'https://identity.deep-id.ai',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'http://localhost:3000/api/v1/auth/deep-id/callback',
    scope: 'openid profile email offline_access',
  };

  const configService = {
    get: vi.fn((key: string) => {
      const values: Record<string, unknown> = {
        'auth.providers': {
          'deep-id': providerConfig,
        },
      };
      return values[key];
    }),
  } as unknown as ConfigService;

  const oauthProviderClient = {
    buildAuthorizationUrl: vi.fn(),
    exchangeCodeForTokens: vi.fn(),
    refreshTokens: vi.fn(),
    fetchUserInfo: vi.fn(),
    getDiscoveryDocument: vi.fn(),
  };

  function createService() {
    vi.clearAllMocks();
    return new OAuthAuthProviderService(configService, oauthProviderClient as unknown as OAuthProviderClient);
  }

  it('normalizes provider auth scopes for application sessions', () => {
    const service = createService();

    expect(service.getScopes('deep-id')).toEqual(['openid', 'profile', 'email', 'offline_access']);
  });

  it('delegates authorization URL construction with provider-specific callback config', async () => {
    const service = createService();
    oauthProviderClient.buildAuthorizationUrl.mockResolvedValue('https://identity.deep-id.ai/oauth2/auth?state=abc');

    await expect(
      service.buildAuthorizationUrl(
        'deep-id',
        {
          provider: 'deep-id',
          state: 'state-123',
          codeVerifier: 'verifier-123',
        },
        'challenge',
      ),
    ).resolves.toBe('https://identity.deep-id.ai/oauth2/auth?state=abc');

    expect(oauthProviderClient.buildAuthorizationUrl).toHaveBeenCalledWith('deep-id', {
      redirectUri: providerConfig.redirectUri,
      scope: providerConfig.scope,
      state: 'state-123',
      codeChallenge: 'challenge',
    });
  });

  it('delegates code exchange with provider-specific callback config', async () => {
    const service = createService();
    oauthProviderClient.exchangeCodeForTokens.mockResolvedValue({
      access_token: 'access-token',
      expires_in: 300,
      token_type: 'Bearer',
    });

    await service.exchangeCodeForTokens('deep-id', 'authorization-code', 'verifier');

    expect(oauthProviderClient.exchangeCodeForTokens).toHaveBeenCalledWith('deep-id', {
      code: 'authorization-code',
      codeVerifier: 'verifier',
      redirectUri: providerConfig.redirectUri,
    });
  });

  it('passes refresh, userinfo, and discovery calls through with the selected provider', async () => {
    const service = createService();

    await service.refreshTokens('deep-id', 'refresh-token');
    await service.fetchUserInfo('deep-id', 'access-token');
    await service.getDiscoveryDocument('deep-id');

    expect(oauthProviderClient.refreshTokens).toHaveBeenCalledWith('deep-id', 'refresh-token');
    expect(oauthProviderClient.fetchUserInfo).toHaveBeenCalledWith('deep-id', 'access-token');
    expect(oauthProviderClient.getDiscoveryDocument).toHaveBeenCalledWith('deep-id');
  });

  it('rejects unknown OAuth providers before delegating', async () => {
    const service = createService();

    expect(() => service.getScopes('unknown' as never)).toThrow(BadRequestException);
    expect(() => service.refreshTokens('unknown' as never, 'refresh-token')).toThrow(BadRequestException);
  });
});
