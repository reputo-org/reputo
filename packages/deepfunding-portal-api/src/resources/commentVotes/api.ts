import type { DeepFundingClient } from '../../api/client.js';
import { endpoints } from '../../api/endpoints.js';
import type { PaginatedFetcher } from '../../shared/types/index.js';
import { validatePaginationOptions } from '../../shared/utils/index.js';
import type { CommentVote, CommentVoteApiResponse, CommentVoteFetchOptions } from './types.js';

export async function* fetchCommentVotes(
  client: DeepFundingClient,
  options: CommentVoteFetchOptions = {},
): PaginatedFetcher<CommentVote> {
  validatePaginationOptions(options);

  let nextPage: number | null = options.page ?? 1;
  const limit = options.limit ?? client.config.defaultPageLimit;

  while (nextPage !== null) {
    const page = nextPage;
    const params: Record<string, string | number> = {
      page,
      limit,
    };
    const response = await client.get<CommentVoteApiResponse>(endpoints.commentVotes(), params);
    yield { data: response.votes, pagination: response.pagination };
    nextPage = response.pagination.next_page;
  }
}
