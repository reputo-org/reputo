import pLimit from 'p-limit';
import { postScores } from '../resources/scores/api.js';
import type { PostScoresRequest, PostScoresResponse } from '../resources/scores/types.js';
import { getUsers, iterateUsers } from '../resources/users/api.js';
import type { GetUsersOptions, UsersPage, UsersResponse } from '../resources/users/types.js';
import { HttpError } from '../shared/errors/index.js';
import { createLogger } from '../shared/logging/index.js';
import type { DeepIdApiConfig, DeepIdApiConfigInput } from '../shared/types/api-config.js';
import { DEFAULT_CONFIG } from '../shared/types/api-config.js';
import { trimTrailingSlash } from '../shared/utils/index.js';
import { executeRequest, type HttpMethod, type HttpResponse } from './http.js';
import { createTokenManager } from './token.js';

export interface AuthedRequestOptions {
  params?: Record<string, string | number>;
  body?: string;
  contentType?: string;
}

/**
 * Low-level authenticated transport against the application host. Injects the
 * cached bearer token, and on a `401` refreshes the token and retries once.
 * Resource functions (`getUsers`, `postScores`) are built on top of it.
 */
export interface DeepIdRequester {
  config: DeepIdApiConfig;
  request<T>(method: HttpMethod, path: string, options?: AuthedRequestOptions): Promise<HttpResponse<T>>;
}

export interface DeepIdClient {
  config: DeepIdApiConfig;
  /** Walk every page of `GET /v1/users` and return the merged `did:sub:…` → user map. */
  getUsers(options?: GetUsersOptions): Promise<UsersResponse>;
  /** Stream `GET /v1/users` one page at a time (cursor expires after 5 minutes — don't pause mid-walk). */
  iterateUsers(options?: GetUsersOptions): AsyncGenerator<UsersPage, void, void>;
  /** Submit scores via `POST /v1/clients/scores` (synchronous; per-user failures appear in the `200` body). */
  postScores(scores: PostScoresRequest): Promise<PostScoresResponse>;
}

function resolveConfig(input: DeepIdApiConfigInput): DeepIdApiConfig {
  return {
    identityBaseUrl: input.identityBaseUrl,
    appBaseUrl: input.appBaseUrl,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    scopes: input.scopes ?? DEFAULT_CONFIG.scopes,
    requestTimeoutMs: input.requestTimeoutMs ?? DEFAULT_CONFIG.requestTimeoutMs,
    concurrency: input.concurrency ?? DEFAULT_CONFIG.concurrency,
    retry: {
      maxAttempts: input.retry?.maxAttempts ?? DEFAULT_CONFIG.retry.maxAttempts,
      baseDelayMs: input.retry?.baseDelayMs ?? DEFAULT_CONFIG.retry.baseDelayMs,
      maxDelayMs: input.retry?.maxDelayMs ?? DEFAULT_CONFIG.retry.maxDelayMs,
    },
    defaultPageSize: input.defaultPageSize ?? DEFAULT_CONFIG.defaultPageSize,
    tokenRefreshSkewMs: input.tokenRefreshSkewMs ?? DEFAULT_CONFIG.tokenRefreshSkewMs,
  };
}

function buildUrl(baseUrl: string, path: string, params?: Record<string, string | number>): string {
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  const url = new URL(cleanPath, `${baseUrl}/`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export function createDeepIdClient(input: DeepIdApiConfigInput): DeepIdClient {
  const config = resolveConfig(input);
  const logger = createLogger(input.logLevel);
  const tokenManager = createTokenManager(config, logger);
  const limiter = pLimit(config.concurrency);
  const appBaseUrl = trimTrailingSlash(config.appBaseUrl);

  async function authedRequest<T>(
    method: HttpMethod,
    path: string,
    options?: AuthedRequestOptions,
  ): Promise<HttpResponse<T>> {
    const url = buildUrl(appBaseUrl, path, options?.params);

    const send = (token: string): Promise<HttpResponse<T>> => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      };
      if (options?.body !== undefined) {
        headers['Content-Type'] = options.contentType ?? 'application/json';
      }
      return executeRequest<T>(logger, {
        method,
        url,
        headers,
        body: options?.body,
        timeoutMs: config.requestTimeoutMs,
        retry: config.retry,
      });
    };

    const token = await tokenManager.getToken();
    try {
      return await send(token);
    } catch (error) {
      if (error instanceof HttpError && error.statusCode === 401) {
        logger.warn({ msg: 'DeepID returned 401; refreshing token and retrying once', method, url });
        const refreshed = await tokenManager.getToken(true);
        return send(refreshed);
      }
      throw error;
    }
  }

  const requester: DeepIdRequester = {
    config,
    request: (method, path, options) => limiter(() => authedRequest(method, path, options)),
  };

  return {
    config,
    getUsers: (options) => getUsers(requester, options),
    iterateUsers: (options) => iterateUsers(requester, options),
    postScores: (scores) => postScores(requester, scores),
  };
}
