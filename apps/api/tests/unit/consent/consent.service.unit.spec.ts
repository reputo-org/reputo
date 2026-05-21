import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsentService, InvalidConsentStateException } from '../../../src/consent';
import type {
  OAuthConsentGrantRepository,
  OAuthConsentGrantRow,
} from '../../../src/consent/oauth-consent-grant.repository';
import type { OAuthProviderClient } from '../../../src/shared/oauth';
import { createPkceChallenge } from '../../../src/shared/utils';
import { randomUUIDv7 } from '../../utils/uuid';

describe('ConsentService', () => {
  const now = new Date('2026-05-06T12:00:00.000Z');
  const sources = {
    'voting-portal': {
      returnUrl: 'http://localhost:3001/voting',
    },
  };
  const providers = {
    'deep-id': {
      redirectUri: 'http://localhost:3000/api/v1/oauth/consent/deep-id/callback',
      grantTtlSeconds: 600,
      sources: {
        'voting-portal': {
          scope: 'api wallets',
        },
      },
    },
  };

  let grantRepository: {
    create: ReturnType<typeof vi.fn>;
    findActiveByProviderAndState: ReturnType<typeof vi.fn>;
    deleteByProviderAndState: ReturnType<typeof vi.fn>;
  };
  let oauthProviderClient: {
    buildAuthorizationUrl: ReturnType<typeof vi.fn>;
    exchangeCodeForTokens: ReturnType<typeof vi.fn>;
  };
  let logger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };
  let service: ConsentService;

  const grant: OAuthConsentGrantRow = {
    _id: randomUUIDv7(),
    provider: 'deep-id',
    source: 'voting-portal',
    state: 'state-12345678',
    codeVerifier: 'pkce-verifier',
    expiresAt: new Date('2026-05-06T12:10:00.000Z'),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);

    grantRepository = {
      create: vi.fn(async () => undefined),
      findActiveByProviderAndState: vi.fn(),
      deleteByProviderAndState: vi.fn(async () => true),
    };
    oauthProviderClient = {
      buildAuthorizationUrl: vi.fn(async () => 'https://identity.deep-id.ai/oauth2/auth?state=state'),
      exchangeCodeForTokens: vi.fn(async () => undefined),
    };
    logger = {
      info: vi.fn(),
      warn: vi.fn(),
    };

    const configService = {
      get: vi.fn((key: string) => {
        const values: Record<string, unknown> = {
          'consent.providers': providers,
          'consent.sources': sources,
        };
        return values[key];
      }),
    } as unknown as ConfigService;

    service = new ConsentService(
      logger as unknown as PinoLogger,
      grantRepository as unknown as OAuthConsentGrantRepository,
      oauthProviderClient as unknown as OAuthProviderClient,
      configService,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initiate', () => {
    it('persists a transient grant with TTL and returns the OAuth authorization URL', async () => {
      const redirectUrl = await service.initiate('deep-id', 'voting-portal');

      expect(redirectUrl).toBe('https://identity.deep-id.ai/oauth2/auth?state=state');
      expect(grantRepository.create).toHaveBeenCalledTimes(1);

      const createdGrant = grantRepository.create.mock.calls[0][0] as {
        provider: string;
        source: string;
        state: string;
        codeVerifier: string;
        expiresAt: Date;
      };

      expect(createdGrant.provider).toBe('deep-id');
      expect(createdGrant.source).toBe('voting-portal');
      expect(createdGrant.state).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(createdGrant.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(createdGrant.expiresAt).toEqual(new Date('2026-05-06T12:10:00.000Z'));
      expect(oauthProviderClient.buildAuthorizationUrl).toHaveBeenCalledWith('deep-id', {
        redirectUri: 'http://localhost:3000/api/v1/oauth/consent/deep-id/callback',
        scope: 'api wallets',
        state: createdGrant.state,
        codeChallenge: createPkceChallenge(createdGrant.codeVerifier),
      });
    });

    it('rejects an unknown source without creating a grant', async () => {
      await expect(service.initiate('deep-id', 'unknown-source')).rejects.toThrow(BadRequestException);

      expect(grantRepository.create).not.toHaveBeenCalled();
      expect(oauthProviderClient.buildAuthorizationUrl).not.toHaveBeenCalled();
    });
  });

  describe('handleCallback', () => {
    it('exchanges the code, deletes the grant, and returns a success URL', async () => {
      grantRepository.findActiveByProviderAndState.mockResolvedValue(grant);

      const redirectUrl = await service.handleCallback('deep-id', {
        code: 'authorization-code',
        state: grant.state,
        scope: 'api wallets profile',
      });

      expect(redirectUrl).toBe('http://localhost:3001/voting?reputo_connected=success');
      expect(oauthProviderClient.exchangeCodeForTokens).toHaveBeenCalledWith('deep-id', {
        code: 'authorization-code',
        codeVerifier: 'pkce-verifier',
        redirectUri: 'http://localhost:3000/api/v1/oauth/consent/deep-id/callback',
      });
      expect(grantRepository.deleteByProviderAndState).toHaveBeenCalledWith('deep-id', grant.state);
    });

    it('maps provider access_denied to denied_consent and deletes the grant', async () => {
      grantRepository.findActiveByProviderAndState.mockResolvedValue(grant);

      const redirectUrl = await service.handleCallback('deep-id', {
        error: 'access_denied',
        error_description: 'User denied consent',
        state: grant.state,
      });

      expect(redirectUrl).toBe('http://localhost:3001/voting?reputo_connected=error&reason=denied_consent');
      expect(oauthProviderClient.exchangeCodeForTokens).not.toHaveBeenCalled();
      expect(grantRepository.deleteByProviderAndState).toHaveBeenCalledWith('deep-id', grant.state);
    });

    it('maps token exchange failures to provider_error and deletes the grant', async () => {
      grantRepository.findActiveByProviderAndState.mockResolvedValue(grant);
      oauthProviderClient.exchangeCodeForTokens.mockRejectedValue(new Error('upstream failed'));

      const redirectUrl = await service.handleCallback('deep-id', {
        code: 'authorization-code',
        state: grant.state,
      });

      expect(redirectUrl).toBe('http://localhost:3001/voting?reputo_connected=error&reason=provider_error');
      expect(grantRepository.deleteByProviderAndState).toHaveBeenCalledWith('deep-id', grant.state);
    });

    it('maps a missing code to provider_error and deletes the grant', async () => {
      grantRepository.findActiveByProviderAndState.mockResolvedValue(grant);

      const redirectUrl = await service.handleCallback('deep-id', {
        state: grant.state,
      });

      expect(redirectUrl).toBe('http://localhost:3001/voting?reputo_connected=error&reason=provider_error');
      expect(oauthProviderClient.exchangeCodeForTokens).not.toHaveBeenCalled();
      expect(grantRepository.deleteByProviderAndState).toHaveBeenCalledWith('deep-id', grant.state);
    });

    it('throws invalid state without redirecting when state is missing', async () => {
      await expect(service.handleCallback('deep-id', { code: 'authorization-code' })).rejects.toThrow(
        InvalidConsentStateException,
      );

      expect(grantRepository.findActiveByProviderAndState).not.toHaveBeenCalled();
      expect(grantRepository.deleteByProviderAndState).not.toHaveBeenCalled();
    });

    it('throws invalid state without redirecting when no active grant exists', async () => {
      grantRepository.findActiveByProviderAndState.mockResolvedValue(null);

      await expect(
        service.handleCallback('deep-id', { code: 'authorization-code', state: 'missing-state' }),
      ).rejects.toThrow(InvalidConsentStateException);

      expect(grantRepository.deleteByProviderAndState).toHaveBeenCalledWith('deep-id', 'missing-state');
      expect(oauthProviderClient.exchangeCodeForTokens).not.toHaveBeenCalled();
    });
  });
});
