import type { Pagination } from './api.js';

export type PaginationOptions = {
  page?: number;
  /** Items per page; defaults to the client's `defaultPageLimit`. */
  limit?: number;
};

export type PageResult<T> = {
  data: T[];
  pagination: Pagination;
};

export type PaginatedFetcher<T> = AsyncGenerator<PageResult<T>, void, unknown>;
