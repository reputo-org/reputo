import type { DeepFundingClient } from '../../api/client.js';
import { endpoints } from '../../api/endpoints.js';
import type { PaginatedFetcher } from '../../shared/types/index.js';
import { validatePaginationOptions } from '../../shared/utils/index.js';
import type { Comment, CommentApiResponse, CommentFetchOptions } from './types.js';

export async function* fetchComments(
  client: DeepFundingClient,
  options: CommentFetchOptions = {},
): PaginatedFetcher<Comment> {
  validatePaginationOptions(options);

  let nextPage: number | null = options.page ?? 1;
  const limit = options.limit ?? client.config.defaultPageLimit;

  while (nextPage !== null) {
    const page = nextPage;
    const params: Record<string, string | number> = {
      page,
      limit,
    };
    const response = await client.get<CommentApiResponse>(endpoints.comments(), params);
    yield { data: response.comments, pagination: response.pagination };
    nextPage = response.pagination.next_page;
  }
}
