# @reputo/onchain-data

Syncs EVM asset transfer data (Alchemy) and Cardano asset transaction / UTXO data (Blockfrost) into PostgreSQL via TypeORM.

This package predates the standard `data-source.ts` + migrations pattern. It uses `EntitySchema` with `dataSource.synchronize()` under an advisory lock (see [`src/db/client.ts`](src/db/client.ts)).

## What it exports

- `createDb(options)` — creates a PostgreSQL-backed package state. The returned wrapper owns its TypeORM `DataSource` lifecycle (call `await db.destroy()` when done).
- `syncEvmAssetTransfer(...)` — sync raw Alchemy ERC-20 transfer rows into PostgreSQL.
- `syncCardanoAssetTransfer(...)` — sync Blockfrost Cardano asset transactions and normalised transaction UTXOs into PostgreSQL.

## Tables this package owns

- `evm_asset_transfers`
- `evm_asset_transfer_sync_state`
- `cardano_asset_transactions`
- `cardano_transaction_utxos`
- `cardano_transaction_utxo_inputs`
- `cardano_transaction_utxo_input_amounts`
- `cardano_transaction_utxo_outputs`
- `cardano_transaction_utxo_output_amounts`
- `cardano_asset_transaction_sync_state`

The package stores raw provider items for EVM transfers and Cardano asset transactions. Cardano transaction UTXOs use a normalised parent/child table set with the source JSON retained on the parent row. The package does not expose read/query repositories.

## Internal layout

- `src/adapters/evm/transfers` — transfer persistence and sync orchestration.
- `src/adapters/evm/sync-state` — transfer sync-state persistence.
- `src/adapters/evm/provider` — block helpers, provider contracts, Alchemy transport.
- `src/adapters/cardano/transfers` — Cardano transfer persistence and sync.
- `src/adapters/cardano/sync-state` — Cardano sync-state persistence.
- `src/adapters/cardano/provider` — provider contracts and Blockfrost transport.

## Setup

Required configuration:

- A reachable PostgreSQL instance.
- An Alchemy API key for EVM syncs.
- A Blockfrost API key for Cardano syncs.

In Reputo, these are wired through `ONCHAIN_DATABASE_URL`, `ALCHEMY_API_KEY`, and `BLOCKFROST_API_KEY` in the root `.env`. See [Environment variables](../../docs/environment-variables.md).

## Local commands

```bash
pnpm --filter @reputo/onchain-data build
pnpm --filter @reputo/onchain-data test
pnpm --filter @reputo/onchain-data test:postgres
pnpm --filter @reputo/onchain-data typecheck
pnpm --filter @reputo/onchain-data docs
```

`test:postgres` runs the integration suite against a real Postgres container.

## More

- Generated API docs: [docs/README.md](docs/README.md)
