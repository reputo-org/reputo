import { request } from 'undici';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CommunityAuthError,
  CommunityHttpError,
  CommunityNetworkError,
  CommunityPermissionError,
  CommunityRateLimitError,
} from '../../../src/shared/errors.js';
import { calculateBackoffMs, executeRequest, parseRetryAfterMs } from '../../../src/shared/http.js';
import { createStubLogger, mockUndiciResponse, TEST_HTTP_CONFIG } from '../../utils/mock-helpers.js';

vi.mock('undici', () => ({ request: vi.fn() }));

const mockRequest = vi.mocked(request);
const logger = createStubLogger();

const baseOptions = { method: 'GET' as const, url: 'https://discord.com/api/v10/guilds/1/channels' };

describe('executeRequest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns parsed data with the status code and headers', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(200, [{ id: '1' }], { 'x-trace': 'abc' }) as never);

    const response = await executeRequest<{ id: string }[]>(logger, TEST_HTTP_CONFIG, baseOptions);

    expect(response.statusCode).toBe(200);
    expect(response.data).toEqual([{ id: '1' }]);
    expect(response.headers['x-trace']).toBe('abc');
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('returns undefined data for an empty body', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(204, '') as never);

    const response = await executeRequest(logger, TEST_HTTP_CONFIG, baseOptions);

    expect(response.data).toBeUndefined();
  });

  it('raises an auth error on 401 without retrying', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(401, { message: '401: Unauthorized' }) as never);

    await expect(executeRequest(logger, TEST_HTTP_CONFIG, baseOptions)).rejects.toBeInstanceOf(CommunityAuthError);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('raises a permission error on 403 without retrying', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(403, { message: 'Missing Access' }) as never);

    await expect(executeRequest(logger, TEST_HTTP_CONFIG, baseOptions)).rejects.toBeInstanceOf(
      CommunityPermissionError,
    );
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('raises an http error on other 4xx without retrying', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(400, { error: 'invalid_grant' }) as never);

    await expect(executeRequest(logger, TEST_HTTP_CONFIG, baseOptions)).rejects.toBeInstanceOf(CommunityHttpError);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 and succeeds once the limit clears', async () => {
    mockRequest
      .mockResolvedValueOnce(mockUndiciResponse(429, { retry_after: 0.001 }, { 'retry-after': '0' }) as never)
      .mockResolvedValueOnce(mockUndiciResponse(200, { ok: true }) as never);

    const response = await executeRequest<{ ok: boolean }>(logger, TEST_HTTP_CONFIG, baseOptions);

    expect(response.data).toEqual({ ok: true });
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('raises a rate-limit error once the retry budget is spent', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(429, { retry_after: 0 }, { 'retry-after': '0' }) as never);

    await expect(executeRequest(logger, TEST_HTTP_CONFIG, baseOptions)).rejects.toBeInstanceOf(CommunityRateLimitError);
    expect(mockRequest).toHaveBeenCalledTimes(TEST_HTTP_CONFIG.retry.maxAttempts);
  });

  it('retries a 5xx then succeeds', async () => {
    mockRequest
      .mockResolvedValueOnce(mockUndiciResponse(503, 'unavailable') as never)
      .mockResolvedValueOnce(mockUndiciResponse(200, { ok: true }) as never);

    const response = await executeRequest<{ ok: boolean }>(logger, TEST_HTTP_CONFIG, baseOptions);

    expect(response.data).toEqual({ ok: true });
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('gives up on a persistent 5xx with the last http error', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(500, 'boom') as never);

    await expect(executeRequest(logger, TEST_HTTP_CONFIG, baseOptions)).rejects.toBeInstanceOf(CommunityHttpError);
    expect(mockRequest).toHaveBeenCalledTimes(TEST_HTTP_CONFIG.retry.maxAttempts);
  });

  it('retries network failures and surfaces a network error', async () => {
    mockRequest.mockRejectedValue(new Error('socket hang up'));

    await expect(executeRequest(logger, TEST_HTTP_CONFIG, baseOptions)).rejects.toBeInstanceOf(CommunityNetworkError);
    expect(mockRequest).toHaveBeenCalledTimes(TEST_HTTP_CONFIG.retry.maxAttempts);
  });

  it.each([
    ['getaddrinfo ENOTFOUND discord.com', 'ENOTFOUND'],
    ['getaddrinfo EAI_AGAIN discord.com', 'EAI_AGAIN'],
    ['connect EHOSTUNREACH 162.159.0.1:443', 'EHOSTUNREACH'],
  ])('retries the DNS or routing failure %s', async (message, code) => {
    mockRequest.mockRejectedValue(Object.assign(new Error(message), { code }));

    await expect(executeRequest(logger, TEST_HTTP_CONFIG, baseOptions)).rejects.toBeInstanceOf(CommunityNetworkError);
    expect(mockRequest).toHaveBeenCalledTimes(TEST_HTTP_CONFIG.retry.maxAttempts);
  });

  it('keeps the query string out of the logs', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(200, []) as never);

    await executeRequest(logger, TEST_HTTP_CONFIG, {
      method: 'GET',
      url: 'https://discord.com/api/v10/channels/1/messages?limit=1',
    });

    const logged = logger.debug.mock.calls.flat() as { url?: string }[];
    expect(logged.at(0)?.url).toBe('https://discord.com/api/v10/channels/1/messages');
  });

  it('never logs the request body or credential headers', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(200, {}) as never);

    await executeRequest(logger, TEST_HTTP_CONFIG, {
      method: 'POST',
      url: 'https://discord.com/api/v10/oauth2/token',
      headers: { authorization: 'Bot super-secret-token' },
      body: 'client_secret=super-secret-value',
    });

    const logged = JSON.stringify([...logger.debug.mock.calls, ...logger.warn.mock.calls]);
    expect(logged).not.toContain('super-secret-token');
    expect(logged).not.toContain('super-secret-value');
  });

  it('reports every attempt and rate-limit wait to the observer', async () => {
    mockRequest
      .mockResolvedValueOnce(mockUndiciResponse(429, {}, { 'retry-after': '0' }) as never)
      .mockResolvedValueOnce(mockUndiciResponse(200, []) as never);

    const observer = { onRequest: vi.fn(), onRateLimitWait: vi.fn() };
    await executeRequest(logger, TEST_HTTP_CONFIG, baseOptions, observer);

    expect(observer.onRequest).toHaveBeenCalledTimes(2);
    expect(observer.onRateLimitWait).toHaveBeenCalledTimes(1);
    expect(observer.onRateLimitWait).toHaveBeenCalledWith(0);
  });
});

describe('parseRetryAfterMs', () => {
  it('prefers the retry-after header over the body', () => {
    expect(parseRetryAfterMs({ 'retry-after': '2' }, JSON.stringify({ retry_after: 9 }))).toBe(2000);
  });

  it('reads the first value of a repeated header', () => {
    expect(parseRetryAfterMs({ 'retry-after': ['1.5', '9'] }, '')).toBe(1500);
  });

  it('falls back to the body when the header is absent', () => {
    expect(parseRetryAfterMs({}, JSON.stringify({ retry_after: 1.25 }))).toBe(1250);
  });

  it('returns undefined when neither source carries a delay', () => {
    expect(parseRetryAfterMs({}, 'not json')).toBeUndefined();
    expect(parseRetryAfterMs({ 'retry-after': 'soon' }, '{}')).toBeUndefined();
  });
});

describe('calculateBackoffMs', () => {
  it('grows exponentially and stays within the jitter band', () => {
    for (const attempt of [0, 1, 2]) {
      const delay = calculateBackoffMs(attempt, 100, 10_000);
      const capped = 100 * 2 ** attempt;
      expect(delay).toBeGreaterThanOrEqual(capped);
      expect(delay).toBeLessThanOrEqual(capped * 1.5);
    }
  });

  it('never exceeds the cap plus its jitter', () => {
    expect(calculateBackoffMs(20, 100, 1000)).toBeLessThanOrEqual(1500);
  });
});
