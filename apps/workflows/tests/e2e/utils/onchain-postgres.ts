import { createDb } from '@reputo/onchain-data';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { DataSource } from 'typeorm';

/**
 * A synthetic EVM asset-transfer row to seed directly into Postgres. This is the
 * data the on-chain SYNC step would normally fetch from Alchemy (the slow, hour+
 * job) — but token_value_over_time's compute only READS these rows, so the e2e
 * seeds a handful directly and never touches a chain.
 */
export interface EvmTransferSeed {
  uniqueId: string;
  blockNum: string;
  hash: string;
  from: string;
  to: string | null;
  amount: number;
  blockTimestamp: string;
  chain?: string;
  assetIdentifier?: string;
  category?: string;
}

export interface OnchainPostgres {
  databaseUrl: string;
  seedEvmTransfers(transfers: EvmTransferSeed[]): Promise<void>;
  cleanup(): Promise<void>;
}

/**
 * Starts a throwaway Postgres testcontainer, creates the on-chain schema via the
 * real `@reputo/onchain-data` `createDb` (TypeORM synchronize), and returns a
 * handle to seed `evm_asset_transfers` and tear everything down.
 *
 * Gated by callers behind `RUN_POSTGRES_TESTS` — it needs Docker and is skipped
 * in the free-tier CI test job. `@testcontainers/postgresql` is only imported
 * when this module is dynamically loaded inside a gated hook.
 */
export async function startOnchainPostgres(defaultAssetIdentifier: string): Promise<OnchainPostgres> {
  const container = await new PostgreSqlContainer('postgres:16').start();
  const databaseUrl = container.getConnectionUri();
  const db: DataSource = await createDb({ databaseUrl });

  return {
    databaseUrl,
    async seedEvmTransfers(transfers) {
      for (const t of transfers) {
        await db.query(
          `INSERT INTO evm_asset_transfers
             (chain, asset_identifier, block_num, unique_id, hash,
              from_address, to_address, value, asset, category,
              raw_contract, metadata, raw_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb)`,
          [
            t.chain ?? 'ethereum',
            t.assetIdentifier ?? defaultAssetIdentifier,
            t.blockNum,
            t.uniqueId,
            t.hash,
            t.from,
            t.to,
            JSON.stringify(t.amount),
            'FET',
            t.category ?? 'erc20',
            JSON.stringify({}),
            JSON.stringify({ blockTimestamp: t.blockTimestamp }),
            JSON.stringify({}),
          ],
        );
      }
    },
    async cleanup() {
      if (db.isInitialized) {
        await db.destroy();
      }
      await container.stop();
    },
  };
}
