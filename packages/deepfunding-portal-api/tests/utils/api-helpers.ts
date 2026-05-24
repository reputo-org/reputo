import { vi } from 'vitest';
import type { DeepFundingClient } from '../../src/api/client.js';

export function createMockClient(
  mockGet?: ReturnType<typeof vi.fn>,
): DeepFundingClient & { mockGet: ReturnType<typeof vi.fn> } {
  const getMock: ReturnType<typeof vi.fn> = mockGet ?? vi.fn();

  const client = {
    config: {
      baseUrl: 'https://api.test.com',
      apiKey: 'test-api-key',
      requestTimeoutMs: 45000,
      concurrency: 4,
      retry: {
        maxAttempts: 7,
        baseDelayMs: 500,
        maxDelayMs: 20000,
      },
      defaultPageLimit: 500,
    },
    limiter: vi.fn((fn) => fn()) as ReturnType<typeof import('p-limit').default>,
    get: getMock as DeepFundingClient['get'],
    mockGet: getMock,
  } as DeepFundingClient & { mockGet: ReturnType<typeof vi.fn> };

  return client;
}

export function createMockPaginatedResponse<T>(
  data: T[],
  page: number = 1,
  hasNextPage: boolean = false,
): {
  data: T[];
  pagination: {
    current_page: number;
    next_page: number | null;
    prev_page: number | null;
    total_pages: number;
    total_count: number;
  };
} {
  return {
    data,
    pagination: {
      current_page: page,
      next_page: hasNextPage ? page + 1 : null,
      prev_page: page > 1 ? page - 1 : null,
      total_pages: hasNextPage ? page + 1 : page,
      total_count: data.length,
    },
  };
}
