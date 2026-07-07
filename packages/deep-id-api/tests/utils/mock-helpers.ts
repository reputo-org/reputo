import { vi } from 'vitest';
import type { DeepIdRequester } from '../../src/api/client.js';
import type { HttpResponse } from '../../src/api/http.js';
import type { DeepIdApiConfig } from '../../src/shared/types/api-config.js';

export const TEST_CONFIG: DeepIdApiConfig = {
  identityBaseUrl: 'https://identity.test.deep-id.ai',
  appBaseUrl: 'https://app.test.deep-id.ai',
  clientId: 'test-client',
  clientSecret: 'test-secret',
  scopes: 'api wallets post_scores',
  requestTimeoutMs: 1000,
  concurrency: 4,
  retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
  defaultPageSize: 500,
  tokenRefreshSkewMs: 60_000,
};

/** A fake undici `request` result with a `body.text()` reader. */
export function mockUndiciResponse(statusCode: number, body: unknown, headers: Record<string, string | string[]> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    statusCode,
    headers,
    body: { text: () => Promise.resolve(text) },
  };
}

/** Silent logger stub for transport tests. */
export function createStubLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
}

/** A `DeepIdRequester` whose `request` is a Vitest mock, for resource-level tests. */
export function createMockRequester(config: Partial<DeepIdApiConfig> = {}): DeepIdRequester & {
  mockRequest: ReturnType<typeof vi.fn>;
} {
  const mockRequest = vi.fn();
  return {
    config: { ...TEST_CONFIG, ...config },
    request: mockRequest as <T>(...args: never[]) => Promise<HttpResponse<T>>,
    mockRequest,
  };
}
