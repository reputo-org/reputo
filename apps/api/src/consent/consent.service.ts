import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { OAuthProvider } from '@reputo/contracts';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import type { ConsentProviderConfig, ConsentSourceConfig } from '../config/consent.config';
import { OAuthProviderClient } from '../shared/oauth';
import { createPkceChallenge, createRandomToken } from '../shared/utils';
import type { ConsentCallbackQueryDto } from './dto';
import { OAuthConsentGrantRepository } from './oauth-consent-grant.repository';

type ConsentRedirectReason = 'denied_consent' | 'provider_error';

export class InvalidConsentStateException extends Error {
  constructor() {
    super('OAuth consent state is invalid, expired, or already used.');
    this.name = InvalidConsentStateException.name;
  }
}

function getStateSuffix(state: string | undefined): string | undefined {
  return state ? state.slice(-8) : undefined;
}

function buildReturnUrl(returnUrl: string, connected: 'success' | 'error', reason?: ConsentRedirectReason): string {
  const url = new URL(returnUrl);

  url.searchParams.set('reputo_connected', connected);

  if (reason) {
    url.searchParams.set('reason', reason);
  } else {
    url.searchParams.delete('reason');
  }

  return url.toString();
}

@Injectable()
export class ConsentService {
  private readonly providers: Partial<Record<OAuthProvider, ConsentProviderConfig>>;
  private readonly sources: Record<string, ConsentSourceConfig>;

  constructor(
    @InjectPinoLogger(ConsentService.name)
    private readonly logger: PinoLogger,
    private readonly grantRepository: OAuthConsentGrantRepository,
    private readonly oauthProviderClient: OAuthProviderClient,
    configService: ConfigService,
  ) {
    this.providers =
      configService.get<Partial<Record<OAuthProvider, ConsentProviderConfig>>>('consent.providers') ?? {};
    this.sources = configService.get<Record<string, ConsentSourceConfig>>('consent.sources') ?? {};
  }

  async initiate(provider: OAuthProvider, source: string): Promise<string> {
    const providerConfig = this.getProviderConfig(provider);
    const sourceConfig = this.sources[source];
    const providerSourceConfig = providerConfig.sources[source];

    if (!sourceConfig || !providerSourceConfig) {
      throw new BadRequestException(`Unknown OAuth consent source for provider ${provider}: ${source}`);
    }

    const state = createRandomToken(32);
    const codeVerifier = createRandomToken(32);
    const codeChallenge = createPkceChallenge(codeVerifier);
    const expiresAt = new Date(Date.now() + providerConfig.grantTtlSeconds * 1000);

    await this.grantRepository.create({
      provider,
      source,
      state,
      codeVerifier,
      expiresAt,
    });

    return this.oauthProviderClient.buildAuthorizationUrl(provider, {
      redirectUri: providerConfig.redirectUri,
      scope: providerSourceConfig.scope,
      state,
      codeChallenge,
    });
  }

  async handleCallback(provider: OAuthProvider, query: ConsentCallbackQueryDto): Promise<string> {
    if (!query.state) {
      this.logInvalidState(provider, query.state);
      throw new InvalidConsentStateException();
    }

    const grant = await this.grantRepository.findActiveByProviderAndState(provider, query.state);

    if (!grant) {
      await this.grantRepository.deleteByProviderAndState(provider, query.state);
      this.logInvalidState(provider, query.state);
      throw new InvalidConsentStateException();
    }

    const providerConfig = this.getProviderConfig(provider);
    const sourceConfig = this.sources[grant.source];

    try {
      if (!sourceConfig) {
        throw new InvalidConsentStateException();
      }

      if (query.error) {
        const reason: ConsentRedirectReason = query.error === 'access_denied' ? 'denied_consent' : 'provider_error';
        this.logCallback(provider, grant.source, grant.state, 'error', reason);
        return buildReturnUrl(sourceConfig.returnUrl, 'error', reason);
      }

      if (!query.code) {
        this.logCallback(provider, grant.source, grant.state, 'error', 'provider_error');
        return buildReturnUrl(sourceConfig.returnUrl, 'error', 'provider_error');
      }

      try {
        await this.oauthProviderClient.exchangeCodeForTokens(provider, {
          code: query.code,
          codeVerifier: grant.codeVerifier,
          redirectUri: providerConfig.redirectUri,
        });
      } catch {
        this.logCallback(provider, grant.source, grant.state, 'error', 'provider_error');
        return buildReturnUrl(sourceConfig.returnUrl, 'error', 'provider_error');
      }

      this.logCallback(provider, grant.source, grant.state, 'success');
      return buildReturnUrl(sourceConfig.returnUrl, 'success');
    } finally {
      await this.grantRepository.deleteByProviderAndState(provider, grant.state);
    }
  }

  private getProviderConfig(provider: OAuthProvider): ConsentProviderConfig {
    const providerConfig = this.providers[provider];

    if (!providerConfig) {
      throw new BadRequestException(`Unknown OAuth provider: ${provider}`);
    }

    return providerConfig;
  }

  private logInvalidState(provider: OAuthProvider, state: string | undefined): void {
    this.logger.warn(
      {
        provider,
        stateSuffix: getStateSuffix(state),
        outcome: 'error',
        reason: 'invalid_state',
      },
      'OAuth consent callback rejected',
    );
  }

  private logCallback(
    provider: OAuthProvider,
    source: string,
    state: string,
    outcome: 'success' | 'error',
    reason?: ConsentRedirectReason,
  ): void {
    const payload = {
      provider,
      source,
      stateSuffix: getStateSuffix(state),
      outcome,
      ...(reason ? { reason } : {}),
    };

    if (outcome === 'success') {
      this.logger.info(payload, 'OAuth consent callback completed');
    } else {
      this.logger.warn(payload, 'OAuth consent callback completed');
    }
  }
}
