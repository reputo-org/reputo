import { BadGatewayException, BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OAuthProvider } from '@reputo/contracts';
import type { OAuthProviderAuthConfig } from '../../config/auth.config';
import {
  AUTH_MODE_MOCK,
  AUTH_MODE_OAUTH,
  OAUTH_DEFAULT_AUTHORIZATION_PATH,
  OAUTH_DEFAULT_TOKEN_PATH,
  OAUTH_DEFAULT_USERINFO_PATH,
  OAUTH_DISCOVERY_PATH,
} from '../constants';
import { type OAuthDiscoveryDocument, type OAuthTokenResponse, type OAuthUserInfo } from '../types';

interface BuildOAuthAuthorizationUrlParams {
  codeChallenge: string;
  redirectUri: string;
  scope: string | string[];
  state: string;
}

interface ExchangeOAuthCodeParams {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

interface OAuthTokenErrorResponse {
  error?: string;
  error_description?: string;
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/u, '');
}

function scopeToString(scope: string | string[]): string {
  return Array.isArray(scope) ? scope.join(' ') : scope;
}

async function parseJsonResponse<T>(response: Response, provider: OAuthProvider): Promise<T> {
  const text = await response.text();

  if (!text) {
    throw new BadGatewayException(`OAuth provider ${provider} returned an empty response.`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new BadGatewayException(`OAuth provider ${provider} returned malformed JSON.`);
  }
}

@Injectable()
export class OAuthProviderClient {
  private readonly authMode: string;
  private readonly providers: Partial<Record<OAuthProvider, OAuthProviderAuthConfig>>;
  private readonly discoveryPromises = new Map<OAuthProvider, Promise<OAuthDiscoveryDocument>>();

  constructor(configService: ConfigService) {
    this.authMode = (configService.get<string>('auth.mode') ?? AUTH_MODE_OAUTH).toLowerCase();
    this.providers = configService.get<Partial<Record<OAuthProvider, OAuthProviderAuthConfig>>>('auth.providers') ?? {};
  }

  async buildAuthorizationUrl(provider: OAuthProvider, params: BuildOAuthAuthorizationUrlParams): Promise<string> {
    this.ensureOAuthMode(provider);
    const providerConfig = this.getProviderConfig(provider);
    const discovery = await this.getDiscoveryDocument(provider);
    const url = new URL(discovery.authorization_endpoint);

    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', providerConfig.clientId);
    url.searchParams.set('redirect_uri', params.redirectUri);
    url.searchParams.set('scope', scopeToString(params.scope));
    url.searchParams.set('state', params.state);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');

    return url.toString();
  }

  async exchangeCodeForTokens(provider: OAuthProvider, params: ExchangeOAuthCodeParams): Promise<OAuthTokenResponse> {
    this.ensureOAuthMode(provider);
    return this.fetchTokenResponse(provider, {
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
    });
  }

  async refreshTokens(provider: OAuthProvider, refreshToken: string): Promise<OAuthTokenResponse> {
    this.ensureOAuthMode(provider);
    return this.fetchTokenResponse(provider, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
  }

  async fetchUserInfo(provider: OAuthProvider, accessToken: string): Promise<OAuthUserInfo> {
    this.ensureOAuthMode(provider);
    const discovery = await this.getDiscoveryDocument(provider);
    const response = await fetch(discovery.userinfo_endpoint, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new BadGatewayException(`OAuth provider ${provider} userinfo request failed.`);
    }

    return parseJsonResponse<OAuthUserInfo>(response, provider);
  }

  async getDiscoveryDocument(provider: OAuthProvider): Promise<OAuthDiscoveryDocument> {
    this.ensureOAuthMode(provider);
    if (!this.discoveryPromises.has(provider)) {
      this.discoveryPromises.set(provider, this.fetchDiscoveryDocument(provider));
    }

    return this.discoveryPromises.get(provider) as Promise<OAuthDiscoveryDocument>;
  }

  private ensureOAuthMode(provider: OAuthProvider): void {
    if (this.authMode === AUTH_MODE_MOCK) {
      throw new BadGatewayException(`OAuth provider ${provider} is disabled when AUTH_MODE=mock.`);
    }
  }

  private getProviderConfig(provider: OAuthProvider): OAuthProviderAuthConfig {
    const providerConfig = this.providers[provider];

    if (!providerConfig) {
      throw new BadRequestException(`Unknown OAuth provider: ${provider}`);
    }

    return providerConfig;
  }

  private async fetchDiscoveryDocument(provider: OAuthProvider): Promise<OAuthDiscoveryDocument> {
    const providerConfig = this.getProviderConfig(provider);
    const issuerUrl = normalizeUrl(providerConfig.issuerUrl);
    const discoveryUrl = new URL(OAUTH_DISCOVERY_PATH, `${issuerUrl}/`);
    const response = await fetch(discoveryUrl, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new BadGatewayException(`OAuth provider ${provider} discovery request failed.`);
    }

    const discovery = await parseJsonResponse<Partial<OAuthDiscoveryDocument>>(response, provider);
    const issuer = normalizeUrl(discovery.issuer ?? issuerUrl);

    if (issuer !== issuerUrl) {
      throw new UnauthorizedException(`OAuth provider ${provider} discovery issuer does not match configuration.`);
    }

    return {
      issuer,
      authorization_endpoint:
        discovery.authorization_endpoint ?? new URL(OAUTH_DEFAULT_AUTHORIZATION_PATH, `${issuer}/`).toString(),
      token_endpoint: discovery.token_endpoint ?? new URL(OAUTH_DEFAULT_TOKEN_PATH, `${issuer}/`).toString(),
      userinfo_endpoint: discovery.userinfo_endpoint ?? new URL(OAUTH_DEFAULT_USERINFO_PATH, `${issuer}/`).toString(),
    };
  }

  private async fetchTokenResponse(
    provider: OAuthProvider,
    params: Record<string, string>,
  ): Promise<OAuthTokenResponse> {
    const providerConfig = this.getProviderConfig(provider);
    const discovery = await this.getDiscoveryDocument(provider);
    const body = new URLSearchParams(params);
    const basicAuthorization = Buffer.from(
      `${providerConfig.clientId}:${providerConfig.clientSecret}`,
      'utf8',
    ).toString('base64');

    const response = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${basicAuthorization}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => null)) as OAuthTokenErrorResponse | null;

      if (errorPayload?.error === 'invalid_grant') {
        throw new UnauthorizedException(
          errorPayload.error_description ?? `OAuth provider ${provider} rejected the authorization grant.`,
        );
      }

      throw new BadGatewayException(
        errorPayload?.error_description ?? `OAuth provider ${provider} token exchange failed.`,
      );
    }

    const tokenResponse = await parseJsonResponse<OAuthTokenResponse>(response, provider);

    if (
      !tokenResponse.access_token ||
      typeof tokenResponse.expires_in !== 'number' ||
      !Number.isFinite(tokenResponse.expires_in) ||
      tokenResponse.expires_in <= 0
    ) {
      throw new BadGatewayException(`OAuth provider ${provider} token response is incomplete.`);
    }

    return tokenResponse;
  }
}
