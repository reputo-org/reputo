# @reputo/api

NestJS application that serves the Reputo HTTP API. It owns the application Postgres database and hosts a Temporal worker for snapshot activities.

## What it does

- URI-versioned routes under `/api/v1`.
- Algorithm preset CRUD at `/algorithm-presets`.
- Snapshot create/list/get/delete and SSE updates at `/snapshots` and `/snapshots/events`.
- Storage upload verification, presigned downloads, and attachment streaming at `/storage`.
- Interactive API reference at `/reference` and `/docs`.
- Temporal worker on the `api-snapshot-activities` task queue that exposes the `getSnapshot` and `updateSnapshot` activities the orchestrator workflow proxies to.

## Local commands

```bash
pnpm --filter @reputo/api dev          # build deps, watch and run Nest
pnpm --filter @reputo/api build
pnpm --filter @reputo/api start        # run the built dist/main
pnpm --filter @reputo/api test
pnpm --filter @reputo/api test:e2e
pnpm --filter @reputo/api typecheck
```

Local development listens on <http://localhost:3000>.

## Configuration

The API validates its environment in [`src/config/env.ts`](src/config/env.ts). Required variables include `DATABASE_URL`, the Deep ID OIDC settings, AWS / storage settings, and Temporal settings. The full list is in the root [`.env.example`](../../.env.example).

## Database

TypeORM owns the schema. Entities live under `src/persistence/entities/`. Migrations live under `src/persistence/migrations/`. Snapshot SSE is driven by PostgreSQL `LISTEN/NOTIFY` on the `snapshot_updates` channel.

Run migrations from the repo root with `pnpm db:migrate`.

## More

- [Documentation](../../docs/README.md)
- [Reputation algorithms](../../docs/reputation-algorithms.md)
- [Local development](../../docs/local-development.md)
