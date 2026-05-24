import type { PaginationOptions } from '../types/fetchers.js';

/**
 * @throws {Error} If page or limit is invalid (must be >= 1)
 */
export function validatePaginationOptions(options: PaginationOptions): void {
  if (options.page !== undefined && options.page < 1) {
    throw new Error(`Invalid page value: ${options.page}. Page must be >= 1`);
  }

  if (options.limit !== undefined && options.limit < 1) {
    throw new Error(`Invalid limit value: ${options.limit}. Limit must be >= 1`);
  }
}
