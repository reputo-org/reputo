import type { Logger } from 'pino';
import { request } from 'undici';
import { HttpError } from '../shared/errors/index.js';
import type { RetryConfig } from '../shared/types/api-config.js';
import { sleep } from '../shared/utils/index.js';

export type HttpMethod = 'GET' | 'POST';

export interface HttpRequestOptions {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  retry: RetryConfig;
}

export interface HttpResponse<T> {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  data: T;
}

export function isRetryableError(error: unknown): boolean {
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

  if (error instanceof HttpError) {
    return error.statusCode === 429 || error.statusCode >= 500;
  }

  return false;
}

/**
 * Non-retryable 4xx (except 429, which is rate-limit and retryable). A `401`
 * also lands here and is surfaced to the caller, which refreshes the token and
 * retries the request once (see `client.ts`).
 */
export function isNonRetryableError(error: unknown): boolean {
  if (error instanceof HttpError) {
    const { statusCode } = error;
    return statusCode >= 400 && statusCode < 500 && statusCode !== 429;
  }
  return false;
}

export function calculateDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponentialDelay = baseDelayMs * 2 ** attempt;
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
  const jitter = Math.random() * cappedDelay * 0.5;
  return cappedDelay + jitter;
}

/**
 * Performs a single HTTP request with exponential-backoff retries on transient
 * failures (429, 5xx, network/timeout). Returns the parsed JSON body alongside
 * the status code and response headers (`x-next` pagination needs the headers).
 */
export async function executeRequest<T>(logger: Logger, options: HttpRequestOptions): Promise<HttpResponse<T>> {
  const { method, url, headers = {}, body, timeoutMs, retry } = options;
  const { maxAttempts, baseDelayMs, maxDelayMs } = retry;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const startTime = Date.now();

    try {
      logger.debug({ msg: 'DeepID request attempt', method, url, attempt: attempt + 1, maxAttempts });

      const response = await request(url, {
        method,
        headers,
        body,
        headersTimeout: timeoutMs,
        bodyTimeout: timeoutMs,
      });

      const duration = Date.now() - startTime;
      const text = await response.body.text();

      logger.debug({
        msg: 'DeepID response',
        method,
        url,
        statusCode: response.statusCode,
        duration,
        attempt: attempt + 1,
      });

      if (response.statusCode >= 400) {
        throw new HttpError(response.statusCode, (response.headers['status-text'] as string) || 'Error', text);
      }

      const data = (text.length > 0 ? JSON.parse(text) : undefined) as T;
      return { statusCode: response.statusCode, headers: response.headers, data };
    } catch (error) {
      const duration = Date.now() - startTime;
      lastError = error instanceof Error ? error : new Error(String(error));

      logger.warn({
        msg: 'DeepID request failed',
        method,
        url,
        attempt: attempt + 1,
        maxAttempts,
        duration,
        error: lastError.message,
      });

      if (isNonRetryableError(error) || !isRetryableError(error)) {
        throw error;
      }

      if (attempt < maxAttempts - 1) {
        const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs);
        logger.debug({ msg: 'Retrying after delay', delay, attempt: attempt + 1 });
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error('Request failed after all retries');
}
