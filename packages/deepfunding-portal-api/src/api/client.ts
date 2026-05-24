import type pLimit from 'p-limit';
import { createLogger } from '../shared/logging/index.js';
import type { DeepFundingPortalApiConfig, DeepFundingPortalApiConfigInput } from '../shared/types/api-config.js';
import { DEFAULT_CONFIG } from '../shared/types/api-config.js';
import { createLimiter, executeRequest } from './http.js';

/**
 * DeepFunding Portal API client
 */
export type DeepFundingClient = {
  /** Full configuration */
  config: DeepFundingPortalApiConfig;
  /** Concurrency limiter */
  limiter: ReturnType<typeof pLimit>;
  /** Execute a GET request with retry logic */
  get: <T>(path: string, params?: Record<string, string | number>) => Promise<T>;
};

/**
 * Create a DeepFunding Portal API client
 */
export function createDeepFundingClient(input: DeepFundingPortalApiConfigInput): DeepFundingClient {
  const config: DeepFundingPortalApiConfig = {
    baseUrl: input.baseUrl,
    apiKey: input.apiKey,
    requestTimeoutMs: input.requestTimeoutMs ?? DEFAULT_CONFIG.requestTimeoutMs,
    concurrency: input.concurrency ?? DEFAULT_CONFIG.concurrency,
    retry: {
      maxAttempts: input.retry?.maxAttempts ?? DEFAULT_CONFIG.retry.maxAttempts,
      baseDelayMs: input.retry?.baseDelayMs ?? DEFAULT_CONFIG.retry.baseDelayMs,
      maxDelayMs: input.retry?.maxDelayMs ?? DEFAULT_CONFIG.retry.maxDelayMs,
    },
    defaultPageLimit: input.defaultPageLimit ?? DEFAULT_CONFIG.defaultPageLimit,
  };

  // Create logger using shared logger factory
  const logger = createLogger(input.logLevel);

  const limiter = createLimiter(config);

  return {
    config,
    limiter,
    get: <T>(path: string, params?: Record<string, string | number>) => {
      return limiter(() => executeRequest<T>(config, logger, path, params));
    },
  };
}
