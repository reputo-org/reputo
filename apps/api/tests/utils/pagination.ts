import { expect } from 'vitest';

export interface PaginationResponse<T> {
  results: T[];
  page: number;
  limit: number;
  totalPages: number;
  totalResults: number;
}

export function assertPaginationStructure<T>(response: PaginationResponse<T>) {
  expect(response).toHaveProperty('results');
  expect(response).toHaveProperty('page');
  expect(response).toHaveProperty('limit');
  expect(response).toHaveProperty('totalPages');
  expect(response).toHaveProperty('totalResults');
  expect(Array.isArray(response.results)).toBe(true);
  expect(typeof response.page).toBe('number');
  expect(typeof response.limit).toBe('number');
  expect(typeof response.totalPages).toBe('number');
  expect(typeof response.totalResults).toBe('number');
}

export function assertPaginationMath(response: PaginationResponse<any>) {
  const expectedTotalPages = Math.ceil(response.totalResults / response.limit);
  expect(response.totalPages).toBe(expectedTotalPages);

  expect(response.results.length).toBeLessThanOrEqual(response.limit);

  if (response.page < response.totalPages) {
    expect(response.results.length).toBe(response.limit);
  }
}

export function assertSortOrder<T>(results: T[], sortField: keyof T, order: 'asc' | 'desc' = 'asc') {
  if (results.length <= 1) return;

  for (let i = 0; i < results.length - 1; i++) {
    const current = results[i][sortField];
    const next = results[i + 1][sortField];

    if (order === 'asc') {
      expect(current <= next).toBe(true);
    } else {
      expect(current >= next).toBe(true);
    }
  }
}
