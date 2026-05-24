import type { Round, RoundRecord } from './types.js';

export function normalizeRoundToRecord(data: Round): RoundRecord {
  const poolIds = data.pool_id && Array.isArray(data.pool_id) ? data.pool_id.map((p) => p.id) : [];

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    description: data.description || null,
    poolIds: JSON.stringify(poolIds),
    rawJson: JSON.stringify(data),
  };
}
