import type { DataSource } from 'typeorm';

import { CARDANO_ASSET_TRANSACTIONS_TABLE } from '../asset-transactions/schema.js';
import {
  CARDANO_TRANSACTION_UTXO_INPUT_AMOUNTS_TABLE,
  CARDANO_TRANSACTION_UTXO_INPUTS_TABLE,
  CARDANO_TRANSACTION_UTXO_OUTPUT_AMOUNTS_TABLE,
  CARDANO_TRANSACTION_UTXO_OUTPUTS_TABLE,
} from '../transaction-utxos/schema.js';

export interface CardanoUtxoInput {
  address: string;
  amounts: Array<{ unit: string; quantity: string }>;
}

export interface CardanoUtxoOutput {
  address: string;
  output_index: number;
  amounts: Array<{ unit: string; quantity: string }>;
}

export interface CardanoRawTransactionUtxoData {
  tx_hash: string;
  block_height: number;
  block_time: number;
  inputs: CardanoUtxoInput[];
  outputs: CardanoUtxoOutput[];
}

export interface CardanoTransferReadRepository {
  findTransactionsByAddresses(input: {
    assetIdentifier: string;
    addresses: string[];
    page: number;
    limit: number;
    fromTimestampUnix?: number;
    toTimestampUnix?: number;
  }): Promise<CardanoRawTransactionUtxoData[]>;
}

export function createCardanoTransferReadRepository(db: DataSource): CardanoTransferReadRepository {
  return {
    async findTransactionsByAddresses(input) {
      if (input.addresses.length === 0) {
        return [];
      }

      const offset = (input.page - 1) * input.limit;
      const chain = 'cardano';
      const params: unknown[] = [chain, input.assetIdentifier];
      let paramIndex = 3;

      const addressPlaceholders = input.addresses.map((addr) => {
        params.push(addr);
        return `$${paramIndex++}`;
      });
      const addressList = addressPlaceholders.join(', ');

      let timeFilter = '';
      if (input.fromTimestampUnix != null) {
        params.push(input.fromTimestampUnix);
        timeFilter += ` AND cat.block_time >= $${paramIndex++}`;
      }
      if (input.toTimestampUnix != null) {
        params.push(input.toTimestampUnix);
        timeFilter += ` AND cat.block_time <= $${paramIndex++}`;
      }

      params.push(input.limit, offset);

      const txQuery = `
        SELECT DISTINCT cat.tx_hash, cat.block_height, cat.block_time
        FROM ${CARDANO_ASSET_TRANSACTIONS_TABLE} cat
        WHERE cat.chain = $1
          AND cat.asset_identifier = $2
          ${timeFilter}
          AND EXISTS (
            SELECT 1 FROM ${CARDANO_TRANSACTION_UTXO_INPUTS_TABLE} i
            WHERE i.chain = cat.chain AND i.tx_hash = cat.tx_hash
              AND i.address IN (${addressList})
            UNION ALL
            SELECT 1 FROM ${CARDANO_TRANSACTION_UTXO_OUTPUTS_TABLE} o
            WHERE o.chain = cat.chain AND o.tx_hash = cat.tx_hash
              AND o.address IN (${addressList})
          )
        ORDER BY cat.block_height ASC, cat.tx_hash ASC
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}
      `;

      const txRows: Array<{ tx_hash: string; block_height: number; block_time: number }> = await db.query(
        txQuery,
        params,
      );

      if (txRows.length === 0) {
        return [];
      }

      const txHashes = txRows.map((r) => r.tx_hash);
      const txHashPlaceholders = txHashes.map((_, idx) => `$${idx + 2}`);
      const txHashList = txHashPlaceholders.join(', ');

      const inputsQuery = `
        SELECT i.tx_hash, i.input_index, i.address, ia.unit, ia.quantity
        FROM ${CARDANO_TRANSACTION_UTXO_INPUTS_TABLE} i
        JOIN ${CARDANO_TRANSACTION_UTXO_INPUT_AMOUNTS_TABLE} ia
          ON ia.chain = i.chain AND ia.tx_hash = i.tx_hash AND ia.input_index = i.input_index
        WHERE i.chain = $1 AND i.tx_hash IN (${txHashList})
        ORDER BY i.tx_hash, i.input_index, ia.amount_index
      `;

      const inputRows: Array<{
        tx_hash: string;
        input_index: number;
        address: string;
        unit: string;
        quantity: string;
      }> = await db.query(inputsQuery, [chain, ...txHashes]);

      const outputsQuery = `
        SELECT o.tx_hash, o.output_index, o.address, oa.unit, oa.quantity
        FROM ${CARDANO_TRANSACTION_UTXO_OUTPUTS_TABLE} o
        JOIN ${CARDANO_TRANSACTION_UTXO_OUTPUT_AMOUNTS_TABLE} oa
          ON oa.chain = o.chain AND oa.tx_hash = o.tx_hash AND oa.output_index = o.output_index
        WHERE o.chain = $1 AND o.tx_hash IN (${txHashList})
        ORDER BY o.tx_hash, o.output_index, oa.amount_index
      `;

      const outputRows: Array<{
        tx_hash: string;
        output_index: number;
        address: string;
        unit: string;
        quantity: string;
      }> = await db.query(outputsQuery, [chain, ...txHashes]);

      const txMap = new Map<string, CardanoRawTransactionUtxoData>();
      for (const row of txRows) {
        txMap.set(row.tx_hash, {
          tx_hash: row.tx_hash,
          block_height: row.block_height,
          block_time: row.block_time,
          inputs: [],
          outputs: [],
        });
      }

      const inputGroupKey = (r: { tx_hash: string; input_index: number }) => `${r.tx_hash}:${r.input_index}`;
      const inputGroups = new Map<string, { address: string; amounts: Array<{ unit: string; quantity: string }> }>();
      for (const row of inputRows) {
        const key = inputGroupKey(row);
        let group = inputGroups.get(key);
        if (!group) {
          group = { address: row.address, amounts: [] };
          inputGroups.set(key, group);
        }
        group.amounts.push({ unit: row.unit, quantity: row.quantity });
      }

      for (const [key, group] of inputGroups) {
        const txHash = key.split(':')[0];
        const tx = txMap.get(txHash);
        if (tx) {
          tx.inputs.push(group);
        }
      }

      const outputGroupKey = (r: { tx_hash: string; output_index: number }) => `${r.tx_hash}:${r.output_index}`;
      const outputGroups = new Map<
        string,
        { address: string; output_index: number; amounts: Array<{ unit: string; quantity: string }> }
      >();
      for (const row of outputRows) {
        const key = outputGroupKey(row);
        let group = outputGroups.get(key);
        if (!group) {
          group = { address: row.address, output_index: row.output_index, amounts: [] };
          outputGroups.set(key, group);
        }
        group.amounts.push({ unit: row.unit, quantity: row.quantity });
      }

      for (const [key, group] of outputGroups) {
        const txHash = key.split(':')[0];
        const tx = txMap.get(txHash);
        if (tx) {
          tx.outputs.push(group);
        }
      }

      return txRows.map((row) => {
        const transaction = txMap.get(row.tx_hash);
        if (!transaction) {
          throw new Error(`Missing transfer transaction for hash ${row.tx_hash}`);
        }

        return transaction;
      });
    },
  };
}
