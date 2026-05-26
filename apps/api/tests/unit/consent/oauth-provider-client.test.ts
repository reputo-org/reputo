import { BadGatewayException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuthProviderClient } from '../../../src/shared/oauth';

const DISCOVERY_DOCUMENT = {
  issuer: 'https://identity.deep-id.ai',
  authorization_endpoint: 'https://identity.deep-id.ai/oauth2/auth',
  token_endpoint: 'https://identity.deep-id.ai/oauth2/token',
  userinfo_endpoint: 'https://identity.deep-id.ai/userinfo',
};

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('OAuthProviderClient', () => {
  const configValues: Record<string, unknown> = {
    'auth.mode': 'oauth',
    'auth.providers': {
      'deep-id': {
        issuerUrl: 'https://identity.deep-id.ai',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'http://localhost:3000/api/v1/auth/deep-id/callback',
        scope: 'openid profile email offline_access',
      },
    },
  };
  const fetchMock = vi.fn();
  let service: OAuthProviderClient;

  function createService(overrides: Record<string, unknown> = {}) {
    const merged = { ...configValues, ...overrides };
    const configService = {
      get: vi.fn((key: string) => merged[key]),
    } as unknown as ConfigService;

    return new OAuthProviderClient(configService);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    service = createService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds a PKCE S256 authorization URL with source scopes', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(DISCOVERY_DOCUMENT));

    const url = await service.buildAuthorizationUrl('deep-id', {
      redirectUri: 'http://localhost:3000/api/v1/oauth/consent/deep-id/callback',
      scope: 'api wallets',
      state: 'state',
      codeChallenge: 'challenge',
    });
    const parsed = new URL(url);

    expect(parsed.origin).toBe('https://identity.deep-id.ai');
    expect(parsed.pathname).toBe('/oauth2/auth');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe('client-id');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/v1/oauth/consent/deep-id/callback');
    expect(parsed.searchParams.get('scope')).toBe('api wallets');
    expect(parsed.searchParams.get('state')).toBe('state');
    expect(parsed.searchParams.get('code_challenge')).toBe('challenge');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('uses HTTP Basic client authentication for the authorization code exchange', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(DISCOVERY_DOCUMENT))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'access-token', expires_in: 300, token_type: 'Bearer' }));

    await service.exchangeCodeForTokens('deep-id', {
      code: 'authorization-code',
      codeVerifier: 'pkce-verifier',
      redirectUri: 'http://localhost:3000/api/v1/oauth/consent/deep-id/callback',
    });

    const [, requestInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const headers = requestInit.headers as Record<string, string>;
    const body = new URLSearchParams(requestInit.body as URLSearchParams);

    expect(headers.Authorization).toBe(`Basic ${Buffer.from('client-id:client-secret', 'utf8').toString('base64')}`);
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('authorization-code');
    expect(body.get('redirect_uri')).toBe('http://localhost:3000/api/v1/oauth/consent/deep-id/callback');
    expect(body.get('code_verifier')).toBe('pkce-verifier');
    expect(body.get('client_id')).toBeNull();
    expect(body.get('client_secret')).toBeNull();
  });

  it('throws provider-facing errors for token endpoint failures and malformed bodies', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(DISCOVERY_DOCUMENT))
      .mockResolvedValueOnce(new Response('', { status: 500 }));

    await expect(
      service.exchangeCodeForTokens('deep-id', {
        code: 'code',
        codeVerifier: 'verifier',
        redirectUri: 'http://localhost:3000/api/v1/oauth/consent/deep-id/callback',
      }),
    ).rejects.toThrow(BadGatewayException);

    fetchMock.mockReset();
    service = createService();
    fetchMock
      .mockResolvedValueOnce(jsonResponse(DISCOVERY_DOCUMENT))
      .mockResolvedValueOnce(new Response('{not-json', { status: 200 }));

    await expect(
      service.exchangeCodeForTokens('deep-id', {
        code: 'code',
        codeVerifier: 'verifier',
        redirectUri: 'http://localhost:3000/api/v1/oauth/consent/deep-id/callback',
      }),
    ).rejects.toThrow(BadGatewayException);
  });

  it('rejects discovery documents from the wrong issuer', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...DISCOVERY_DOCUMENT, issuer: 'https://wrong.example.com' }));

    await expect(service.getDiscoveryDocument('deep-id')).rejects.toThrow(UnauthorizedException);
  });
});
