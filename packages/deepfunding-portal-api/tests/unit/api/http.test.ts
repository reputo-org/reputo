import { request } from 'undici';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calculateDelay,
  createLimiter,
  executeRequest,
  isNonRetryableError,
  isRetryableError,
} from '../../../src/api/http.js';
import { HttpError } from '../../../src/shared/errors/index.js';
import { createLogger } from '../../../src/shared/logging/index.js';
import type { DeepFundingPortalApiConfig } from '../../../src/shared/types/api-config.js';

// Mock undici
vi.mock('undici', () => ({
  request: vi.fn(),
}));

// Mock logger
vi.mock('../../../src/shared/logging/index.js', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('HTTP Utils', () => {
  const mockLogger = createLogger();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createLimiter', () => {
    it('should create a limiter with specified concurrency', () => {
      const config: DeepFundingPortalApiConfig = {
        baseUrl: 'https://api.test.com',
        apiKey: 'test-key',
        requestTimeoutMs: 45000,
        concurrency: 5,
        retry: {
          maxAttempts: 3,
          baseDelayMs: 500,
          maxDelayMs: 20000,
        },
        defaultPageLimit: 500,
      };

      const limiter = createLimiter(config);
      expect(limiter).toBeDefined();
      expect(typeof limiter).toBe('function');
    });
  });

  describe('isRetryableError', () => {
    it('should return true for network timeout errors', () => {
      const error = new Error('Request timeout');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for connection reset errors', () => {
      const error = new Error('ECONNRESET');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for connection refused errors', () => {
      const error = new Error('ECONNREFUSED');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for socket hang up errors', () => {
      const error = new Error('socket hang up');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for network errors', () => {
      const error = new Error('network error');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for 429 status code', () => {
      const error = new HttpError(429, 'Too Many Requests');
      expect(isRetryableError(error)).toBe(true);
    });

    it('should return true for 5xx status codes', () => {
      const statusCodes = [500, 502, 503, 504];
      for (const statusCode of statusCodes) {
        const error = new HttpError(statusCode, 'Server Error');
        expect(isRetryableError(error)).toBe(true);
      }
    });

    it('should return false for 4xx errors (except 429)', () => {
      const statusCodes = [400, 401, 403, 404];
      for (const statusCode of statusCodes) {
        const error = new HttpError(statusCode, 'Client Error');
        expect(isRetryableError(error)).toBe(false);
      }
    });

    it('should return false for non-HTTP errors without network keywords', () => {
      const error = new Error('Some other error');
      expect(isRetryableError(error)).toBe(false);
    });
  });

  describe('isNonRetryableError', () => {
    it('should return true for 4xx errors (except 429)', () => {
      const statusCodes = [400, 401, 403, 404];
      for (const statusCode of statusCodes) {
        const error = new HttpError(statusCode, 'Client Error');
        expect(isNonRetryableError(error)).toBe(true);
      }
    });

    it('should return false for 429', () => {
      const error = new HttpError(429, 'Too Many Requests');
      expect(isNonRetryableError(error)).toBe(false);
    });

    it('should return false for 5xx errors', () => {
      const error = new HttpError(500, 'Server Error');
      expect(isNonRetryableError(error)).toBe(false);
    });

    it('should return false for non-HTTP errors', () => {
      const error = new Error('Some error');
      expect(isNonRetryableError(error)).toBe(false);
    });
  });

  describe('calculateDelay', () => {
    it('should calculate exponential backoff', () => {
      const delay1 = calculateDelay(0, 500, 20000);
      const delay2 = calculateDelay(1, 500, 20000);
      const delay3 = calculateDelay(2, 500, 20000);

      expect(delay1).toBeGreaterThanOrEqual(500);
      expect(delay2).toBeGreaterThan(delay1);
      expect(delay3).toBeGreaterThan(delay2);
    });

    it('should cap delay at maxDelayMs', () => {
      const delay = calculateDelay(10, 500, 20000);
      expect(delay).toBeLessThanOrEqual(20000 * 1.5); // Max delay + jitter
    });

    it('should include jitter', () => {
      const delays: number[] = [];
      for (let i = 0; i < 10; i++) {
        delays.push(calculateDelay(2, 500, 20000));
      }

      // All delays should be different due to jitter
      const uniqueDelays = new Set(delays);
      expect(uniqueDelays.size).toBeGreaterThan(1);
    });
  });

  describe('executeRequest', () => {
    const config: DeepFundingPortalApiConfig = {
      baseUrl: 'https://api.test.com',
      apiKey: 'test-key',
      requestTimeoutMs: 45000,
      concurrency: 4,
      retry: {
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 1000,
      },
      defaultPageLimit: 500,
    };

    it('should execute successful request', async () => {
      const mockResponse = {
        statusCode: 200,
        headers: {},
        body: {
          text: vi.fn().mockResolvedValue('{"data": "test"}'),
        },
      };

      vi.mocked(request).mockResolvedValue(mockResponse as never);

      const result = await executeRequest<{ data: string }>(config, mockLogger, '/test');

      expect(result).toEqual({ data: 'test' });
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('should handle URL with trailing slash in baseUrl', async () => {
      const configWithSlash: DeepFundingPortalApiConfig = {
        ...config,
        baseUrl: 'https://api.test.com/',
      };

      const mockResponse = {
        statusCode: 200,
        headers: {},
        body: {
          text: vi.fn().mockResolvedValue('{"data": "test"}'),
        },
      };

      vi.mocked(request).mockResolvedValue(mockResponse as never);

      await executeRequest(configWithSlash, mockLogger, '/test');

      const callUrl = vi.mocked(request).mock.calls[0]?.[0] as string;
      expect(callUrl).toBe('https://api.test.com/test');
    });

    it('should handle path without leading slash', async () => {
      const mockResponse = {
        statusCode: 200,
        headers: {},
        body: {
          text: vi.fn().mockResolvedValue('{"data": "test"}'),
        },
      };

      vi.mocked(request).mockResolvedValue(mockResponse as never);

      await executeRequest(config, mockLogger, 'test');

      const callUrl = vi.mocked(request).mock.calls[0]?.[0] as string;
      expect(callUrl).toBe('https://api.test.com/test');
    });

    it('should include query parameters', async () => {
      const mockResponse = {
        statusCode: 200,
        headers: {},
        body: {
          text: vi.fn().mockResolvedValue('{"data": "test"}'),
        },
      };

      vi.mocked(request).mockResolvedValue(mockResponse as never);

      await executeRequest(config, mockLogger, '/test', {
        page: 1,
        limit: 10,
      });

      const callUrl = vi.mocked(request).mock.calls[0]?.[0] as string;
      expect(callUrl).toContain('page=1');
      expect(callUrl).toContain('limit=10');
    });

    it('should include authentication header', async () => {
      const mockResponse = {
        statusCode: 200,
        headers: {},
        body: {
          text: vi.fn().mockResolvedValue('{"data": "test"}'),
        },
      };

      vi.mocked(request).mockResolvedValue(mockResponse as never);

      await executeRequest(config, mockLogger, '/test');

      const callOptions = vi.mocked(request).mock.calls[0]?.[1];
      const legacyHeaderName = ['authententicaion', 'key'].join('-');
      expect(callOptions?.headers).toHaveProperty('authentication-key', 'test-key');
      expect(callOptions?.headers).not.toHaveProperty(legacyHeaderName);
      expect(callOptions?.headers).toHaveProperty('Accept', 'application/json');
    });

    it('should throw HttpError for 4xx responses', async () => {
      const mockResponse = {
        statusCode: 404,
        headers: { 'status-text': 'Not Found' },
        body: {
          text: vi.fn().mockResolvedValue('{"error": "Not found"}'),
        },
      };

      vi.mocked(request).mockResolvedValue(mockResponse as never);

      await expect(executeRequest(config, mockLogger, '/test')).rejects.toThrow(HttpError);
      await expect(executeRequest(config, mockLogger, '/test')).rejects.toThrow('HTTP 404');
    });

    it('should retry on retryable errors', async () => {
      const mockResponse = {
        statusCode: 200,
        headers: {},
        body: {
          text: vi.fn().mockResolvedValue('{"data": "test"}'),
        },
      };

      // First call fails with timeout, second succeeds
      vi.mocked(request)
        .mockRejectedValueOnce(new Error('Request timeout'))
        .mockResolvedValueOnce(mockResponse as never);

      const result = await executeRequest(config, mockLogger, '/test');

      expect(result).toEqual({ data: 'test' });
      expect(request).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable errors', async () => {
      const mockResponse = {
        statusCode: 400,
        headers: { 'status-text': 'Bad Request' },
        body: {
          text: vi.fn().mockResolvedValue('{"error": "Bad request"}'),
        },
      };

      vi.mocked(request).mockResolvedValue(mockResponse as never);

      await expect(executeRequest(config, mockLogger, '/test')).rejects.toThrow(HttpError);
      expect(request).toHaveBeenCalledTimes(1);
    });

    it('should respect maxAttempts', async () => {
      // All attempts fail with retryable error
      vi.mocked(request).mockRejectedValue(new Error('Request timeout'));

      await expect(executeRequest(config, mockLogger, '/test')).rejects.toThrow();

      expect(request).toHaveBeenCalledTimes(config.retry.maxAttempts);
    });
  });
});
