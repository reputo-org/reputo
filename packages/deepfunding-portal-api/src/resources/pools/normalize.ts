import type { Pool, PoolRecord } from './types.js';

export function normalizePoolToRecord(data: Pool): PoolRecord {
  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    maxFundingAmount: data.max_funding_amount,
    description: data.description || null,
    rawJson: JSON.stringify(data),
  };
}
