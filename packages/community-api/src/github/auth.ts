import { createSign } from 'node:crypto';
import {
  CommunityAuthError,
  CommunityContractError,
  CommunityPermissionError,
  CommunityRateLimitError,
} from '../shared/errors.js';
import { type CommunityHttpObserver, type CommunityLogger, executeRequest, type HttpMethod } from '../shared/http.js';
import { GITHUB_API_BASE_URL, GITHUB_API_HEADERS, type GitHubAppConfig, type GitHubRateLimit } from './types.js';

/** GitHub caps an app JWT at 10 minutes; stay under it and backdate for clock drift. */
const APP_JWT_LIFETIME_SECONDS = 540;
const APP_JWT_BACKDATE_SECONDS = 60;

/** Installation tokens live an hour; mint a new one before the last minutes of it. */
const INSTALLATION_TOKEN_SKEW_MS = 5 * 60_000;

const base64url = (value: string | Buffer): string =>
  (typeof value === 'string' ? Buffer.from(value, 'utf8') : value).toString('base64url');

/**
 * Signed app JWT — the credential that mints installation tokens. RS256 over
 * the App's private key, which stays deployment configuration and never leaves
 * this process.
 */
export function createAppJwt(
  config: Pick<GitHubAppConfig, 'appId' | 'privateKey'>,
  nowMs: number = Date.now(),
): string {
  const issuedAt = Math.floor(nowMs / 1000) - APP_JWT_BACKDATE_SECONDS;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({ iat: issuedAt, exp: issuedAt + APP_JWT_LIFETIME_SECONDS, iss: config.appId }),
  );

  try {
    const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).end().sign(config.privateKey);
    return `${header}.${payload}.${base64url(signature)}`;
  } catch {
    // The message would otherwise carry OpenSSL detail about the key material.
    throw new CommunityContractError('The GitHub App private key is not a usable RSA key.');
  }
}

interface InstallationTokenResponse {
  token?: unknown;
  expires_at?: unknown;
}

interface RateLimitHeaders {
  'x-ratelimit-limit'?: string | string[];
  'x-ratelimit-remaining'?: string | string[];
  'x-ratelimit-reset'?: string | string[];
}

function readRateLimit(headers: Record<string, string | string[] | undefined>): GitHubRateLimit | undefined {
  const read = (name: keyof RateLimitHeaders): number => {
    const value = headers[name];
    return Number(Array.isArray(value) ? value[0] : value);
  };

  const limit = read('x-ratelimit-limit');
  const remaining = read('x-ratelimit-remaining');
  const resetAt = read('x-ratelimit-reset');

  return Number.isFinite(limit) && Number.isFinite(remaining) && Number.isFinite(resetAt)
    ? { limit, remaining, resetAt }
    : undefined;
}

/**
 * The authenticated GitHub transport: app-JWT calls for the App itself and
 * installation-token calls for everything an installation can read.
 */
export interface GitHubApi {
  appRequest<T>(method: HttpMethod, path: string): Promise<T>;
  installationRequest<T>(installationId: string, method: HttpMethod, path: string): Promise<T>;
  /** Latest installation rate-limit snapshot seen, for the run's fetch stats. */
  rateLimit(): GitHubRateLimit | undefined;
}

/**
 * Builds the transport for one App. Installation tokens are minted per
 * installation, cached in memory for the process's lifetime only, and refreshed
 * before they expire — never persisted, never logged.
 */
export function createGitHubApi(
  config: GitHubAppConfig,
  logger: CommunityLogger,
  observer?: CommunityHttpObserver,
): GitHubApi {
  const tokens = new Map<string, { token: string; expiresAtMs: number }>();
  const inFlight = new Map<string, Promise<string>>();
  let rateLimit: GitHubRateLimit | undefined;

  // App-JWT calls draw on the App's own budget, so only installation responses
  // may move the snapshot the crawl reports and throttles against.
  const send = async <T>(method: HttpMethod, path: string, authorization: string, trackRateLimit = false) => {
    const response = await executeRequest<T>(
      logger,
      config,
      {
        method,
        url: `${GITHUB_API_BASE_URL}${path}`,
        headers: { ...GITHUB_API_HEADERS, authorization },
        throttleOnSpentBudget: true,
      },
      observer,
    );
    if (trackRateLimit) {
      rateLimit = readRateLimit(response.headers) ?? rateLimit;
    }
    return response.data;
  };

  const budgetExhausted = (): boolean =>
    rateLimit !== undefined && rateLimit.remaining <= 0 && rateLimit.resetAt * 1000 > Date.now();

  const fetchInstallationToken = async (installationId: string): Promise<string> => {
    const response = await send<InstallationTokenResponse>(
      'POST',
      `/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
      `Bearer ${createAppJwt(config)}`,
    );
    if (typeof response?.token !== 'string' || response.token.length === 0) {
      throw new CommunityContractError('GitHub returned no installation token for this installation.');
    }

    const expiresAtMs = typeof response.expires_at === 'string' ? Date.parse(response.expires_at) : Number.NaN;
    tokens.set(installationId, {
      token: response.token,
      expiresAtMs: Number.isNaN(expiresAtMs) ? Date.now() + INSTALLATION_TOKEN_SKEW_MS : expiresAtMs,
    });
    return response.token;
  };

  const getInstallationToken = (installationId: string, forceRefresh = false): Promise<string> => {
    const cached = tokens.get(installationId);
    if (!forceRefresh && cached && Date.now() < cached.expiresAtMs - INSTALLATION_TOKEN_SKEW_MS) {
      return Promise.resolve(cached.token);
    }
    if (forceRefresh) {
      tokens.delete(installationId);
    }

    let pending = inFlight.get(installationId);
    if (!pending) {
      pending = fetchInstallationToken(installationId).finally(() => inFlight.delete(installationId));
      inFlight.set(installationId, pending);
    }
    return pending;
  };

  return {
    appRequest: (method, path) => send(method, path, `Bearer ${createAppJwt(config)}`),

    async installationRequest<T>(installationId: string, method: HttpMethod, path: string): Promise<T> {
      // An hourly budget spent by an earlier attempt cannot be waited out
      // inside one activity; fail fast so the retry resumes after the reset.
      if (budgetExhausted()) {
        throw new CommunityRateLimitError(
          'The GitHub installation rate limit is exhausted for this window.',
          rateLimit ? Math.max(0, rateLimit.resetAt * 1000 - Date.now()) : undefined,
        );
      }

      try {
        return await send<T>(method, path, `token ${await getInstallationToken(installationId)}`, true);
      } catch (error) {
        // GitHub answers an exhausted primary budget with 403 and a spent
        // `x-ratelimit-remaining`; only the snapshot tells the two apart.
        if (error instanceof CommunityPermissionError && budgetExhausted()) {
          throw new CommunityRateLimitError('The GitHub installation rate limit is exhausted for this window.');
        }
        if (!(error instanceof CommunityAuthError)) {
          throw error;
        }
        // A revoked or rotated installation token is indistinguishable from an
        // uninstalled App until a fresh mint is attempted.
        return await send<T>(method, path, `token ${await getInstallationToken(installationId, true)}`, true);
      }
    },

    rateLimit: () => rateLimit,
  };
}
