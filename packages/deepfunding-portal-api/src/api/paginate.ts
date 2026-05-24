import type { PaginatedFetcher } from '../shared/types/index.js';

export async function fetchAllPages<T>(fetcher: PaginatedFetcher<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const page of fetcher) {
    results.push(...page.data);
  }
  return results;
}
