# @reputo/onchain-data

Workspace package for syncing EVM asset transfer data and Cardano asset transaction/UTXO data into PostgreSQL via TypeORM.

This package predates the standard `data-source.ts` + migrations pattern and
uses `EntitySchema` plus `dataSource.synchronize()` from
[src/db/client.ts](src/db/client.ts) under an advisory lock.

## Public Surface

- `createDb` for PostgreSQL-backed package state
- `syncEvmAssetTransfer` for syncing raw Alchemy ERC-20 transfer rows into PostgreSQL
- `syncCardanoAssetTransfer` for syncing Blockfrost Cardano asset transactions and normalized transaction UTXOs into PostgreSQL

## Internal Layout

- `src/adapters/evm/transfers` owns transfer persistence and sync orchestration
- `src/adapters/evm/sync-state` owns transfer sync-state persistence
- `src/adapters/evm/provider` owns block helpers, provider contracts, and Alchemy transport
- `src/adapters/cardano/transfers` owns Cardano transfer persistence and sync orchestration
- `src/adapters/cardano/sync-state` owns Cardano sync-state persistence
- `src/adapters/cardano/provider` owns provider contracts and Blockfrost transport

## Stored Tables

- `evm_asset_transfers`
- `evm_asset_transfer_sync_state`
- `cardano_asset_transactions`
- `cardano_transaction_utxos`
- `cardano_transaction_utxo_inputs`
- `cardano_transaction_utxo_input_amounts`
- `cardano_transaction_utxo_outputs`
- `cardano_transaction_utxo_output_amounts`
- `cardano_asset_transaction_sync_state`

The package stores raw provider items for EVM transfers and Cardano asset transactions, while Cardano transaction UTXOs are persisted in a normalized parent/child table set with the source JSON retained on the parent row. It does not expose read/query repositories. The returned TypeORM `DataSource` owns its own lifecycle via `await db.destroy()`.

## Commands

```bash
pnpm --filter @reputo/onchain-data build
pnpm --filter @reputo/onchain-data test
pnpm --filter @reputo/onchain-data test:postgres
pnpm --filter @reputo/onchain-data typecheck
pnpm --filter @reputo/onchain-data docs
```
