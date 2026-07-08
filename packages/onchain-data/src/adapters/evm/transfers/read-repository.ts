import type { DataSource } from 'typeorm';

import { EVM_ASSET_TRANSFERS_TABLE, type EvmAssetTransferRow } from './schema.js';

// block_num is Alchemy hex text ('0x1b4') — text ORDER BY mis-sorts across hex-digit
// lengths, so pagination and replay order sort on the decoded numeric value instead.
const BLOCK_NUM_NUMERIC = `(('x' || lpad(ltrim(lower(block_num), '0x'), 16, '0'))::bit(64)::bigint)`;

export interface EvmTransferReadRepository {
  findTransfersByAddresses(input: {
    chain: string;
    assetIdentifier: string;
    addresses: string[];
    page: number;
    limit: number;
    orderBy: 'time_asc';
    fromTimestampUnix?: number;
    toTimestampUnix?: number;
  }): Promise<EvmAssetTransferRow[]>;
}

export function createEvmTransferReadRepository(db: DataSource): EvmTransferReadRepository {
  return {
    async findTransfersByAddresses(input) {
      if (input.addresses.length === 0) {
        return [];
      }

      const offset = (input.page - 1) * input.limit;
      const params: unknown[] = [input.chain, input.assetIdentifier, input.addresses];
      let paramIndex = 4;

      let timeFilter = '';
      if (input.fromTimestampUnix != null) {
        params.push(new Date(input.fromTimestampUnix * 1000).toISOString());
        timeFilter += ` AND metadata->>'blockTimestamp' >= $${paramIndex++}`;
      }
      if (input.toTimestampUnix != null) {
        params.push(new Date(input.toTimestampUnix * 1000).toISOString());
        timeFilter += ` AND metadata->>'blockTimestamp' <= $${paramIndex++}`;
      }

      params.push(input.limit, offset);

      const query = `
        SELECT *
        FROM ${EVM_ASSET_TRANSFERS_TABLE}
        WHERE chain = $1
          AND asset_identifier = $2
          AND (from_address = ANY($3) OR to_address = ANY($3))
          ${timeFilter}
        ORDER BY ${BLOCK_NUM_NUMERIC} ASC, unique_id ASC
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}
      `;

      return db.query(query, params);
    },
  };
}
