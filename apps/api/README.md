# @reputo/api

NestJS application that exposes the Reputo HTTP API and owns the application
PostgreSQL database.

## Surface

- URI-versioned routes under `/api/v1`
- algorithm preset CRUD at `/algorithm-presets`
- snapshot create/list/get/delete plus SSE updates at `/snapshots` and `/snapshots/events`
- storage upload verification, presigned downloads, and attachment streaming at `/storage`
- health check at `/healthz`
- interactive docs at `/reference` and `/api/docs`
- Temporal worker on the `api-snapshot-activities` task queue (`API_SNAPSHOT_ACTIVITIES_TASK_QUEUE` in `@reputo/contracts`) that exposes the `getSnapshot` and `updateSnapshot` activities the orchestrator workflow proxies to.

## Persistence

TypeORM via `@nestjs/typeorm` owns the schema. Entities live under
`src/persistence/entities/`, the standalone CLI DataSource is
`src/persistence/data-source.ts`, and migrations live under
`src/persistence/migrations/`. Snapshot SSE is driven by PostgreSQL
`LISTEN/NOTIFY` on the `snapshot_updates` channel — every replica listens and
fans NOTIFY payloads out to in-process SSE subjects.

Cross-workspace conventions (entities, naming strategy, transactions,
pagination, tests) live in
[docs/runbooks/typeorm-conventions.md](../../docs/runbooks/typeorm-conventions.md).

Generate and run migrations:

```bash
pnpm --filter @reputo/api typeorm:generate src/persistence/migrations/<Name>
pnpm --filter @reputo/api typeorm:run      # apply pending migrations
pnpm --filter @reputo/api typeorm:revert   # roll back the last migration
pnpm --filter @reputo/api typeorm:show     # list applied/pending
```

`pnpm --filter @reputo/api test:e2e` spins up a Postgres container via
`@testcontainers/postgresql` and runs `dataSource.runMigrations()` so tests
exercise the same SQL production runs.

## Commands

```bash
pnpm --filter @reputo/api dev
pnpm --filter @reputo/api build
pnpm --filter @reputo/api start
pnpm --filter @reputo/api test
pnpm --filter @reputo/api test:e2e
pnpm --filter @reputo/api typecheck
```

`pnpm --filter @reputo/api dev` builds and watches its shared package dependencies before starting Nest. `dev:app` is the internal app-only process used by the root monorepo `pnpm dev`.

## Config

Use `apps/api/envs.example` as the local reference file. The API expects
`DATABASE_URL` (Postgres), storage/AWS, DeepID, and Temporal settings before
startup. `TEMPORAL_API_SNAPSHOT_ACTIVITIES_TASK_QUEUE` defaults to
`api-snapshot-activities` from `@reputo/contracts` and rarely needs an
override. Local development listens on `http://localhost:3000` unless `PORT`
overrides it.
