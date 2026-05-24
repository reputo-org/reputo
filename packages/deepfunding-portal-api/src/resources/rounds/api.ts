import type { DeepFundingClient } from '../../api/client.js';
import { endpoints } from '../../api/endpoints.js';
import type { Round } from './types.js';

export async function fetchRounds(client: DeepFundingClient): Promise<Round[]> {
  return await client.get<Round[]>(endpoints.rounds());
}
