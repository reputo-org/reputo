# @reputo/onchain-data

Syncs raw EVM and Cardano asset-transfer data into PostgreSQL (TypeORM).

It exists to provide the onchain dataset that the workflows `onchain-data` worker resolves as a
snapshot dependency. Its Postgres instance is its own and is independent of the API's application database.

Public API is `src/index.ts`; chain adapters in `src/adapters`, persistence in `src/db`.

Integration tests need a real Postgres and are opt-in:

```bash
pnpm --filter @reputo/onchain-data test            # unit
pnpm --filter @reputo/onchain-data test:integration # sets RUN_POSTGRES_TESTS=true
``
```
