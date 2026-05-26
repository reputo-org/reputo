import type { DeepFundingClient } from '../../api/client.js';
import { endpoints } from '../../api/endpoints.js';
import type { PaginatedFetcher } from '../../shared/types/index.js';
import { validatePaginationOptions } from '../../shared/utils/index.js';
import type { Milestone, MilestoneApiResponse, MilestoneFetchOptions } from './types.js';

/**
 * The API returns milestones grouped by proposal. This function flattens
 * the nested structure by extracting individual milestones from each group and
 * enriching them with proposal-level metadata (proposal_id, created_at, updated_at).
 */
export async function* fetchMilestones(
  client: DeepFundingClient,
  options: MilestoneFetchOptions = {},
): PaginatedFetcher<Milestone> {
  validatePaginationOptions(options);

  let nextPage: number | null = options.page ?? 1;
  const limit = options.limit ?? client.config.defaultPageLimit;

  while (nextPage !== null) {
    const page = nextPage;
    const params: Record<string, string | number> = {
      page,
      limit,
    };
    const response = await client.get<MilestoneApiResponse>(endpoints.milestones(), params);

    const flattenedMilestones: Milestone[] = [];
    for (const group of response.milestones) {
      for (const milestone of group.milestones) {
        flattenedMilestones.push({
          ...milestone,
          proposal_id: group.proposal_id,
          created_at: group.created_at,
          updated_at: group.updated_at,
        });
      }
    }

    yield { data: flattenedMilestones, pagination: response.pagination };
    nextPage = response.pagination.next_page;
  }
}
