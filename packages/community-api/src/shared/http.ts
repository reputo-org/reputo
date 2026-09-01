import { type Dispatcher, request } from 'undici';
import {
  CommunityAuthError,
  CommunityHttpError,
  CommunityNetworkError,
  CommunityOutboundPolicyError,
  CommunityPermissionError,
  CommunityRateLimitError,
} from './errors.js';
import type { CommunityHttpConfig } from './types.js';

/**
 * Structural logger, satisfied by both pino's `Logger` and nestjs-pino's
 * `PinoLogger`, so the transport stays free of a logging dependency.
 */
export interface CommunityLogger {
  debug(payload: object): void;
  warn(payload: object): void;
}

export type HttpMethod = 'GET' | 'POST' | 'DELETE';

/**
 * Optional transport hooks for fetch-stats collection: one `onRequest` per
 * attempted platform call, one `onRateLimitWait` per 429-induced sleep. The
 * community dataset manifest records what they count.
 */
export interface CommunityHttpObserver {
  onRequest?(): void;
  onRateLimitWait?(delayMs: number): void;
}

export interface HttpRequestOptions {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  /** Pre-encoded request body. Never logged. */
  body?: string;
  /**
   * Treat a 403 that reports `x-ratelimit-remaining: 0` as a spent request
   * budget rather than a refusal. GitHub answers an exhausted primary limit
   * that way and sends no `retry-after`; Discord sends the same header on
   * genuine permission failures, so platforms opt in.
   */
  throttleOnSpentBudget?: boolean;
  /**
   * Dispatcher override for the safe outbound path: it pins the connection to
   * pre-validated addresses, so DNS cannot be re-resolved between the policy
   * check and the socket.
   */
  dispatcher?: Dispatcher;
  /** Reject any 3xx as a policy violation instead of returning it. */
  rejectRedirects?: boolean;
  /** Cap on response body bytes; exceeding it is a policy violation. */
  maxResponseBytes?: number;
}

export interface HttpResponse<T> {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  data: T;
}

/**
 * Transport failures worth another attempt. Covers DNS (`enotfound`,
 * `eai_again`), refused and reset sockets, unreachable routes, and undici's own
 * `UND_ERR_*` codes — all transient, none of them a decision by the platform.
 */
const NETWORK_ERROR_HINTS = [
  'timeout',
  'etimedout',
  'econnreset',
  'econnrefused',
  'econnaborted',
  'enotfound',
  'eai_again',
  'ehostunreach',
  'enetunreach',
  'epipe',
  'socket hang up',
  'network',
  'und_err',
];

/** Query strings can carry state and client ids; only the path is ever logged. */
function redactUrl(url: string): string {
  const queryStart = url.indexOf('?');
  return queryStart === -1 ? url : url.slice(0, queryStart);
}

function firstHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  const code = String((error as { code?: unknown }).code ?? '').toLowerCase();
  return NETWORK_ERROR_HINTS.some((hint) => message.includes(hint) || code.includes(hint));
}

/**
 * Milliseconds the platform asked us to wait. Discord sends `retry-after` as a
 * seconds header and repeats it as a float in the JSON body; the header wins,
 * the body is the fallback.
 */
export function parseRetryAfterMs(
  headers: Record<string, string | string[] | undefined>,
  body: string,
): number | undefined {
  const header = firstHeader(headers, 'retry-after');
  const headerSeconds = header === undefined ? Number.NaN : Number(header);
  if (Number.isFinite(headerSeconds) && headerSeconds >= 0) {
    return Math.round(headerSeconds * 1000);
  }

  try {
    const parsed = JSON.parse(body) as { retry_after?: unknown };
    if (typeof parsed.retry_after === 'number' && Number.isFinite(parsed.retry_after) && parsed.retry_after >= 0) {
      return Math.round(parsed.retry_after * 1000);
    }
  } catch {
    // Not JSON; fall through to the caller's backoff.
  }

  return undefined;
}

/**
 * Milliseconds until the request budget refills, from an `x-ratelimit-reset`
 * epoch-seconds header. Undefined when the platform sent no usable reset.
 */
export function parseRateLimitResetMs(
  headers: Record<string, string | string[] | undefined>,
  nowMs: number = Date.now(),
): number | undefined {
  const reset = Number(firstHeader(headers, 'x-ratelimit-reset'));
  return Number.isFinite(reset) ? Math.max(0, reset * 1000 - nowMs) : undefined;
}

/** True when the platform reports this response spent the last of the budget. */
function hasSpentBudget(headers: Record<string, string | string[] | undefined>): boolean {
  return Number(firstHeader(headers, 'x-ratelimit-remaining')) === 0;
}

export function calculateBackoffMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const capped = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
  return capped + Math.random() * capped * 0.5;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reads the body while counting bytes, so an attacker-controlled origin cannot
 * stream an unbounded response. Abandoning the iterator destroys the stream.
 */
async function readBodyText(body: AsyncIterable<Buffer> & { text(): Promise<string> }, maxBytes?: number) {
  if (maxBytes === undefined) return body.text();

  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new CommunityOutboundPolicyError(`Platform response exceeded the ${maxBytes}-byte cap.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * One platform call with exponential backoff and jitter on transient failures
 * (throttles, 5xx, network). A `retry-after` header overrides the computed backoff.
 * Auth and permission failures are surfaced immediately as typed errors so the
 * caller can move the connection to `broken` instead of retrying.
 */
export async function executeRequest<T>(
  logger: CommunityLogger,
  config: CommunityHttpConfig,
  options: HttpRequestOptions,
  observer?: CommunityHttpObserver,
): Promise<HttpResponse<T>> {
  const { method, url, headers = {}, body } = options;
  const { maxAttempts, baseDelayMs, maxDelayMs } = config.retry;
  const safeUrl = redactUrl(url);
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const startedAt = Date.now();
    observer?.onRequest?.();

    try {
      const response = await request(url, {
        method,
        headers,
        body,
        dispatcher: options.dispatcher,
        headersTimeout: config.requestTimeoutMs,
        bodyTimeout: config.requestTimeoutMs,
      });

      if (options.rejectRedirects === true && response.statusCode >= 300 && response.statusCode < 400) {
        await response.body.dump();
        throw new CommunityOutboundPolicyError('Platform answered with a redirect, which the outbound policy refuses.');
      }
      const text = await readBodyText(response.body, options.maxResponseBytes);

      logger.debug({
        msg: 'Community platform response',
        method,
        url: safeUrl,
        statusCode: response.statusCode,
        durationMs: Date.now() - startedAt,
        attempt: attempt + 1,
      });

      if (response.statusCode === 401) {
        throw new CommunityAuthError('Platform rejected the credentials.', response.statusCode);
      }
      // A spent budget is not a permission decision, and a 403 is how GitHub
      // reports both: `retry-after` marks its secondary limit, a zero
      // `x-ratelimit-remaining` its primary one.
      const spentBudget = options.throttleOnSpentBudget === true && hasSpentBudget(response.headers);
      const throttled =
        response.statusCode === 429 ||
        (response.statusCode === 403 && (spentBudget || firstHeader(response.headers, 'retry-after') !== undefined));
      if (response.statusCode === 403 && !throttled) {
        throw new CommunityPermissionError('Platform denied access to this resource.', response.statusCode);
      }

      // The budget refills on the platform's own schedule — up to an hour out,
      // which no in-process backoff can wait for. Surface it so the caller
      // retries the whole fetch after the reset instead of sleeping here.
      if (throttled && spentBudget) {
        throw new CommunityRateLimitError(
          'Platform request budget is spent for this window.',
          parseRateLimitResetMs(response.headers),
        );
      }

      if (throttled) {
        const retryAfterMs = parseRetryAfterMs(response.headers, text);
        if (attempt === maxAttempts - 1) {
          throw new CommunityRateLimitError('Platform rate limit exhausted the retry budget.', retryAfterMs);
        }
        const delay = retryAfterMs ?? calculateBackoffMs(attempt, baseDelayMs, maxDelayMs);
        logger.warn({ msg: 'Community platform rate limited', method, url: safeUrl, delay, attempt: attempt + 1 });
        observer?.onRateLimitWait?.(delay);
        await sleep(delay);
        continue;
      }
      if (response.statusCode >= 400) {
        const error = new CommunityHttpError(response.statusCode, 'Platform request failed', text);
        if (response.statusCode < 500) throw error;
        lastError = error;
        logger.warn({
          msg: 'Community platform request failed',
          method,
          url: safeUrl,
          statusCode: response.statusCode,
          attempt: attempt + 1,
        });
        if (attempt < maxAttempts - 1) {
          await sleep(calculateBackoffMs(attempt, baseDelayMs, maxDelayMs));
        }
        continue;
      }

      return {
        statusCode: response.statusCode,
        headers: response.headers,
        data: (text.length > 0 ? JSON.parse(text) : undefined) as T,
      };
    } catch (error) {
      if (!isNetworkError(error)) throw error;

      lastError = new CommunityNetworkError(`Could not reach the platform: ${(error as Error).message}`);
      logger.warn({
        msg: 'Community platform request failed',
        method,
        url: safeUrl,
        durationMs: Date.now() - startedAt,
        attempt: attempt + 1,
        error: (error as Error).message,
      });

      if (attempt < maxAttempts - 1) {
        await sleep(calculateBackoffMs(attempt, baseDelayMs, maxDelayMs));
      }
    }
  }

  throw lastError ?? new CommunityNetworkError('Platform request failed after all retries.');
}
