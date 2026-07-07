import { request } from 'undici';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executeRequest, isNonRetryableError, isRetryableError } from '../../../src/api/http.js';
import { HttpError } from '../../../src/shared/errors/index.js';
import { createStubLogger, mockUndiciResponse, TEST_CONFIG } from '../../utils/mock-helpers.js';

vi.mock('undici', () => ({ request: vi.fn() }));

const mockRequest = vi.mocked(request);
const logger = createStubLogger();

const baseOptions = {
  method: 'GET' as const,
  url: 'https://app.test.deep-id.ai/v1/users',
  timeoutMs: TEST_CONFIG.requestTimeoutMs,
  retry: TEST_CONFIG.retry,
};

describe('executeRequest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns parsed data plus status and headers', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(200, { ok: true }, { 'x-next': 'cursor-1' }) as never);

    const res = await executeRequest<{ ok: boolean }>(logger, baseOptions);

    expect(res.statusCode).toBe(200);
    expect(res.data).toEqual({ ok: true });
    expect(res.headers['x-next']).toBe('cursor-1');
  });

  it('throws HttpError on a 4xx and does not retry', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(400, 'bad request') as never);

    await expect(executeRequest(logger, baseOptions)).rejects.toBeInstanceOf(HttpError);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx then succeeds', async () => {
    mockRequest
      .mockResolvedValueOnce(mockUndiciResponse(503, 'unavailable') as never)
      .mockResolvedValueOnce(mockUndiciResponse(200, { ok: true }) as never);

    const res = await executeRequest<{ ok: boolean }>(logger, baseOptions);

    expect(res.data).toEqual({ ok: true });
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxAttempts on persistent 5xx', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(500, 'boom') as never);

    await expect(executeRequest(logger, baseOptions)).rejects.toBeInstanceOf(HttpError);
    expect(mockRequest).toHaveBeenCalledTimes(TEST_CONFIG.retry.maxAttempts);
  });
});

describe('error classification', () => {
  it('treats 429 and 5xx as retryable', () => {
    expect(isRetryableError(new HttpError(429, 'rate'))).toBe(true);
    expect(isRetryableError(new HttpError(502, 'bad gateway'))).toBe(true);
    expect(isRetryableError(new Error('socket hang up'))).toBe(true);
  });

  it('treats 4xx (except 429) as non-retryable', () => {
    expect(isNonRetryableError(new HttpError(401, 'unauthorized'))).toBe(true);
    expect(isNonRetryableError(new HttpError(429, 'rate'))).toBe(false);
    expect(isRetryableError(new HttpError(400, 'bad'))).toBe(false);
  });
});
