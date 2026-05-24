import type { DeepFundingClient } from '../../api/client.js';
import { endpoints } from '../../api/endpoints.js';
import type { PaginatedFetcher } from '../../shared/types/index.js';
import { validatePaginationOptions } from '../../shared/utils/index.js';
import type { User, UserApiResponse, UserFetchOptions } from './types.js';

export async function* fetchUsers(client: DeepFundingClient, options: UserFetchOptions = {}): PaginatedFetcher<User> {
  validatePaginationOptions(options);

  let nextPage: number | null = options.page ?? 1;
  const limit = options.limit ?? client.config.defaultPageLimit;

  while (nextPage !== null) {
    const page = nextPage;
    const params: Record<string, string | number> = {
      page,
      limit,
    };
    const response = await client.get<UserApiResponse>(endpoints.users(), params);
    yield { data: response.users, pagination: response.pagination };
    nextPage = response.pagination.next_page;
  }
}
