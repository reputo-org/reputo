# @reputo/deepfunding-portal-api

DeepFunding Portal API client and SQLite ingest utilities. Used by the workflow worker to fetch rounds, pools, proposals, users, milestones, reviews, comments, and comment votes, and persist them locally per snapshot.

## What it exports

- `createDeepFundingClient(options)` — HTTP client with the endpoint fetchers and pagination helpers.
- `createDb(path)` — async; initialises the TypeORM `DataSource` and runs migrations before returning the wrapper.
- `closeDbInstance(db)` — async cleanup.
- `createRepos(db)` plus per-entity repos, normalisers, schemas, and types for rounds, pools, proposals, users, milestones, reviews, comments, and comment votes.
- TypeORM entities (`RoundEntity`, `PoolEntity`, …) and the `AppDataSource` standalone instance for CLI migration commands.

## Usage

```ts
import { createDb, createRepos, createDeepFundingClient } from '@reputo/deepfunding-portal-api';

const client = createDeepFundingClient({ baseUrl, apiKey });
const db = await createDb('./snapshot.db');
const repos = createRepos(db);

const rounds = await client.fetchRounds();
await repos.rounds.upsertMany(rounds);
```

## Persistence

- SQLite via TypeORM's `better-sqlite3` driver.
- Entities live under `src/db/entities/` with camelCase fields and `SnakeNamingStrategy` mapping to snake_case columns.
- Schema changes go through TypeORM migrations under `src/db/migrations/`. The init migration recreates the pre-TypeORM layout. The database is ephemeral per snapshot, so there is no data migration.

## Setup

Required configuration:

- A DeepFunding API base URL.
- A DeepFunding API key.

In Reputo, these are wired through `DEEPFUNDING_API_BASE_URL` and `DEEPFUNDING_API_KEY` in the root `.env`. See [Environment variables](../../docs/environment-variables.md).

## Local commands

```bash
pnpm --filter @reputo/deepfunding-portal-api build
pnpm --filter @reputo/deepfunding-portal-api test
pnpm --filter @reputo/deepfunding-portal-api typecheck
pnpm --filter @reputo/deepfunding-portal-api docs
```

## More

- Generated API docs: [docs/README.md](docs/README.md)
