import type { Logger } from 'pino';
import type { DeepIdApiConfig } from '../shared/types/api-config.js';
import { trimTrailingSlash } from '../shared/utils/index.js';
import { endpoints } from './endpoints.js';
import { executeRequest } from './http.js';

/** Raw `/oauth2/token` response (OAuth 2.0 client-credentials grant). */
export interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export interface TokenManager {
  /**
   * Returns a valid access token, fetching a new one when the cache is empty or
   * within the refresh skew of expiry. Concurrent callers share a single
   * in-flight request. Pass `forceRefresh` to discard the cache (used after a
   * `401`).
   */
  getToken(forceRefresh?: boolean): Promise<string>;
}

/**
 * Caches the M2M client-credentials token and refreshes it shortly before
 * expiry. The token is obtained via HTTP Basic Auth with the client id/secret,
 * per the DeepID auth spec.
 */
export function createTokenManager(config: DeepIdApiConfig, logger: Logger): TokenManager {
  const tokenUrl = `${trimTrailingSlash(config.identityBaseUrl)}${endpoints.token()}`;
  const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

  let cached: { token: string; expiresAtMs: number } | null = null;
  let inFlight: Promise<string> | null = null;

  async function fetchToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: config.scopes,
    }).toString();

    logger.debug({ msg: 'Requesting DeepID M2M token', scope: config.scopes });

    const response = await executeRequest<TokenResponse>(logger, {
      method: 'POST',
      url: tokenUrl,
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
      timeoutMs: config.requestTimeoutMs,
      retry: config.retry,
    });

    const { access_token, expires_in } = response.data;
    cached = { token: access_token, expiresAtMs: Date.now() + expires_in * 1000 };
    logger.debug({ msg: 'DeepID M2M token acquired', expiresInSeconds: expires_in });
    return access_token;
  }

  function isFresh(): boolean {
    return cached !== null && Date.now() < cached.expiresAtMs - config.tokenRefreshSkewMs;
  }

  return {
    async getToken(forceRefresh = false): Promise<string> {
      if (!forceRefresh && isFresh() && cached) {
        return cached.token;
      }
      if (forceRefresh) {
        cached = null;
      }
      if (!inFlight) {
        inFlight = fetchToken().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
  };
}
