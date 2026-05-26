import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeepFundingClient } from '../../../src/api/client.js';
import { DEFAULT_CONFIG } from '../../../src/shared/types/api-config.js';

vi.mock('../../../src/api/http.js', () => ({
  createLimiter: vi.fn(() => vi.fn((fn) => fn())),
  executeRequest: vi.fn(),
}));

describe('DeepFunding Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createDeepFundingClient', () => {
    it('should create client with default config', () => {
      const client = createDeepFundingClient({
        baseUrl: 'https://api.test.com',
        apiKey: 'test-key',
      });

      expect(client.config.baseUrl).toBe('https://api.test.com');
      expect(client.config.apiKey).toBe('test-key');
      expect(client.config.requestTimeoutMs).toBe(DEFAULT_CONFIG.requestTimeoutMs);
      expect(client.config.concurrency).toBe(DEFAULT_CONFIG.concurrency);
      expect(client.config.retry).toEqual(DEFAULT_CONFIG.retry);
      expect(client.config.defaultPageLimit).toBe(DEFAULT_CONFIG.defaultPageLimit);
    });

    it('should create client with custom config', () => {
      const client = createDeepFundingClient({
        baseUrl: 'https://api.custom.com',
        apiKey: 'custom-key',
        requestTimeoutMs: 60000,
        concurrency: 8,
        retry: {
          maxAttempts: 5,
          baseDelayMs: 1000,
          maxDelayMs: 30000,
        },
        defaultPageLimit: 1000,
      });

      expect(client.config.baseUrl).toBe('https://api.custom.com');
      expect(client.config.apiKey).toBe('custom-key');
      expect(client.config.requestTimeoutMs).toBe(60000);
      expect(client.config.concurrency).toBe(8);
      expect(client.config.retry.maxAttempts).toBe(5);
      expect(client.config.retry.baseDelayMs).toBe(1000);
      expect(client.config.retry.maxDelayMs).toBe(30000);
      expect(client.config.defaultPageLimit).toBe(1000);
    });

    it('should merge partial retry config with defaults', () => {
      const client = createDeepFundingClient({
        baseUrl: 'https://api.test.com',
        apiKey: 'test-key',
        retry: {
          maxAttempts: 3,
        },
      });

      expect(client.config.retry.maxAttempts).toBe(3);
      expect(client.config.retry.baseDelayMs).toBe(DEFAULT_CONFIG.retry.baseDelayMs);
      expect(client.config.retry.maxDelayMs).toBe(DEFAULT_CONFIG.retry.maxDelayMs);
    });

    it('should have get method', () => {
      const client = createDeepFundingClient({
        baseUrl: 'https://api.test.com',
        apiKey: 'test-key',
      });

      expect(typeof client.get).toBe('function');
    });

    it('should have limiter', () => {
      const client = createDeepFundingClient({
        baseUrl: 'https://api.test.com',
        apiKey: 'test-key',
      });

      expect(client.limiter).toBeDefined();
      expect(typeof client.limiter).toBe('function');
    });
  });
});
