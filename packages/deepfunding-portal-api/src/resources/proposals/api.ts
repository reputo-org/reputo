import type { DeepFundingClient } from '../../api/client.js';
import { endpoints } from '../../api/endpoints.js';
import type { Proposal, ProposalApiResponse, ProposalFetchOptions } from './types.js';

export async function fetchProposals(
  client: DeepFundingClient,
  roundId: number,
  options: ProposalFetchOptions = {},
): Promise<Proposal[]> {
  const params: Record<string, string | number> = {};
  if (options.poolId !== undefined) {
    params.pool_id = options.poolId;
  }
  const response = await client.get<ProposalApiResponse>(endpoints.proposals(roundId), params);
  return response.proposals;
}
