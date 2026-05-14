import pLimit from 'p-limit';
import type { Logger } from 'pino';
import { request } from 'undici';
import { HttpError } from '../shared/errors/index.js';
import type { DeepFundingPortalApiConfig } from '../shared/types/api-config.js';

// ============================================================================
// Concurrency Limiter
// ============================================================================

/**
 * Create a concurrency limiter for the client
 */
export function createLimiter(config: DeepFundingPortalApiConfig): ReturnType<typeof pLimit> {
  return pLimit(config.concurrency);
}

// ============================================================================
// Retry Utilities
// ============================================================================

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  // Network errors are retryable
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (
      message.includes('timeout') ||
      message.includes('econnreset') ||
      message.includes('econnrefused') ||
      message.includes('socket hang up') ||
      message.includes('network')
    ) {
      return true;
    }
  }

  // HTTP errors: retry on 429 and 5xx
  if (error instanceof HttpError) {
    return error.statusCode === 429 || error.statusCode >= 500;
  }

  return false;
}

/**
 * Check if an error is non-retryable (4xx except 429)
 */
export function isNonRetryableError(error: unknown): boolean {
  if (error instanceof HttpError) {
    const { statusCode } = error;
    return statusCode >= 400 && statusCode < 500 && statusCode !== 429;
  }
  return false;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
export function calculateDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponentialDelay = baseDelayMs * 2 ** attempt;
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  // Add jitter: random value between 0 and 50% of delay
  const jitter = Math.random() * cappedDelay * 0.5;
  return cappedDelay + jitter;
}

/**
 * Sleep for a given duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// HTTP Request Execution
// ============================================================================

/**
 * Execute an HTTP GET request with retry logic
 */
export async function executeRequest<T>(
  config: DeepFundingPortalApiConfig,
  logger: Logger,
  path: string,
  params?: Record<string, string | number>,
): Promise<T> {
  const baseUrl = config.baseUrl.endsWith('/') ? config.baseUrl.slice(0, -1) : config.baseUrl;
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  const url = new URL(cleanPath, `${baseUrl}/`);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {
    'authentication-key': config.apiKey,
    Accept: 'application/json',
  };

  const { maxAttempts, baseDelayMs, maxDelayMs } = config.retry;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const startTime = Date.now();

    try {
      logger.debug({
        msg: 'API request attempt',
        method: 'GET',
        url: url.toString(),
        attempt: attempt + 1,
        maxAttempts,
      });

      const response = await request(url.toString(), {
        method: 'GET',
        headers,
        headersTimeout: config.requestTimeoutMs,
        bodyTimeout: config.requestTimeoutMs,
      });

      const duration = Date.now() - startTime;
      const body = await response.body.text();

      logger.debug({
        msg: 'API response',
        method: 'GET',
        url: url.toString(),
        statusCode: response.statusCode,
        duration,
        attempt: attempt + 1,
      });

      if (response.statusCode >= 400) {
        throw new HttpError(response.statusCode, (response.headers['status-text'] as string) || 'Error', body);
      }

      return JSON.parse(body) as T;
    } catch (error) {
      const duration = Date.now() - startTime;
      lastError = error instanceof Error ? error : new Error(String(error));

      logger.warn({
        msg: 'API request failed',
        method: 'GET',
        url: url.toString(),
        attempt: attempt + 1,
        maxAttempts,
        duration,
        error: lastError.message,
      });

      if (isNonRetryableError(error)) {
        throw error;
      }

      if (!isRetryableError(error)) {
        throw error;
      }
      if (attempt < maxAttempts - 1) {
        const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs);
        logger.debug({
          msg: 'Retrying after delay',
          delay,
          attempt: attempt + 1,
        });
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error('Request failed after all retries');
}
