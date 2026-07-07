import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OAuthProvider } from '@reputo/contracts';
import type { OAuthProviderAuthConfig } from '../config/auth.config';
import { OAuthProviderClient } from '../shared/oauth';
import {
  type AuthFlowState,
  type OAuthClientCredentials,
  type OAuthDiscoveryDocument,
  type OAuthTokenResponse,
  type OAuthUserInfo,
} from '../shared/types';

@Injectable()
export class OAuthAuthProviderService {
  private readonly providers: Partial<Record<OAuthProvider, OAuthProviderAuthConfig>>;
  private readonly oauthProviderClient: OAuthProviderClient;

  constructor(configService: ConfigService, @Optional() oauthProviderClient?: OAuthProviderClient) {
    this.providers = configService.get<Partial<Record<OAuthProvider, OAuthProviderAuthConfig>>>('auth.providers') ?? {};
    this.oauthProviderClient = oauthProviderClient ?? new OAuthProviderClient(configService);
  }

  getScopes(provider: OAuthProvider): string[] {
    return this.getProviderConfig(provider)
      .scope.split(/[,\s]+/u)
      .map((scope) => scope.trim())
      .filter(Boolean);
  }

  buildAuthorizationUrl(provider: OAuthProvider, authFlow: AuthFlowState, codeChallenge: string): Promise<string> {
    const providerConfig = this.getProviderConfig(provider);

    return this.oauthProviderClient.buildAuthorizationUrl(provider, toCredentials(providerConfig), {
      redirectUri: providerConfig.redirectUri,
      scope: providerConfig.scope,
      state: authFlow.state,
      codeChallenge,
    });
  }

  exchangeCodeForTokens(provider: OAuthProvider, code: string, codeVerifier: string): Promise<OAuthTokenResponse> {
    const providerConfig = this.getProviderConfig(provider);

    return this.oauthProviderClient.exchangeCodeForTokens(provider, toCredentials(providerConfig), {
      code,
      codeVerifier,
      redirectUri: providerConfig.redirectUri,
    });
  }

  refreshTokens(provider: OAuthProvider, refreshToken: string): Promise<OAuthTokenResponse> {
    const providerConfig = this.getProviderConfig(provider);
    return this.oauthProviderClient.refreshTokens(provider, toCredentials(providerConfig), refreshToken);
  }

  fetchUserInfo(provider: OAuthProvider, accessToken: string): Promise<OAuthUserInfo> {
    const providerConfig = this.getProviderConfig(provider);
    return this.oauthProviderClient.fetchUserInfo(provider, toCredentials(providerConfig), accessToken);
  }

  getDiscoveryDocument(provider: OAuthProvider): Promise<OAuthDiscoveryDocument> {
    const providerConfig = this.getProviderConfig(provider);
    return this.oauthProviderClient.getDiscoveryDocument(provider, providerConfig.issuerUrl);
  }

  private getProviderConfig(provider: OAuthProvider): OAuthProviderAuthConfig {
    const providerConfig = this.providers[provider];

    if (!providerConfig) {
      throw new BadRequestException(`Unknown OAuth provider: ${provider}`);
    }

    return providerConfig;
  }
}

function toCredentials(providerConfig: OAuthProviderAuthConfig): OAuthClientCredentials {
  return {
    issuerUrl: providerConfig.issuerUrl,
    clientId: providerConfig.clientId,
    clientSecret: providerConfig.clientSecret,
  };
}
