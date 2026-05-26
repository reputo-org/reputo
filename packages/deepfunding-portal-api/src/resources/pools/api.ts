import type { DeepFundingClient } from '../../api/client.js';
import { endpoints } from '../../api/endpoints.js';
import type { Pool } from './types.js';

export async function fetchPools(client: DeepFundingClient): Promise<Pool[]> {
  return await client.get<Pool[]>(endpoints.pools());
}
