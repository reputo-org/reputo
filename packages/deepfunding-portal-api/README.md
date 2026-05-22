# @reputo/deepfunding-portal-api

Workspace package for fetching DeepFunding Portal data and persisting it to SQLite with TypeORM.

## Public Surface

- `createDeepFundingClient`, endpoint fetchers, and pagination helpers
- `createDb` and `closeDbInstance` (both async; TypeORM `DataSource` is initialized and migrations are run before the wrapper is returned)
- `createRepos` plus repo, normalize, schema, and type exports for rounds, pools, proposals, users, milestones, reviews, comments, and comment votes
- TypeORM entities (`RoundEntity`, `PoolEntity`, ...) and the `AppDataSource` standalone instance for CLI migration commands

## Persistence

- SQLite via TypeORM's `better-sqlite3` driver.
- Entity classes live under `src/db/entities/` with camelCase fields and `SnakeNamingStrategy` mapping to snake_case columns.
- Schema changes go through TypeORM migrations under `src/db/migrations/`. The init migration recreates the pre-TypeORM table layout — DBs are ephemeral per snapshot, so there is no data migration.

## Commands

```bash
pnpm --filter @reputo/deepfunding-portal-api build
pnpm --filter @reputo/deepfunding-portal-api test
pnpm --filter @reputo/deepfunding-portal-api typecheck
pnpm --filter @reputo/deepfunding-portal-api sync
pnpm --filter @reputo/deepfunding-portal-api validate
pnpm --filter @reputo/deepfunding-portal-api fetch-api
pnpm --filter @reputo/deepfunding-portal-api docs
```

## Docs

- Generated API docs: [docs/README.md](docs/README.md)
