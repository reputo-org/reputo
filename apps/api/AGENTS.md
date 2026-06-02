# @reputo/api

NestJS HTTP API served under `/api/v1`. It owns the application Postgres database and hosts a Temporal
worker for snapshot activities.

It is the system's front door and the sole owner of the application database — `@reputo/workflows`
reaches that data only by calling this app's `getSnapshot` / `updateSnapshot` activities (task queue
defined in `@reputo/contracts`). Features are organised controller → service → repository, one folder
per area (`auth`, `consent`, `snapshot`, `algorithm-preset`, `storage`, `users`, `sessions`, `admin`).
Persistence (TypeORM `DataSource`, entities, migrations) lives in `src/persistence`; the Temporal worker
in `src/temporal`; env validation in `src/config/env.ts`.

Snapshot updates reach the UI as Server-Sent Events, driven by Postgres `LISTEN/NOTIFY` on the
`snapshot_updates` channel.

## How to run, test, migrate

```bash
pnpm --filter @reputo/api dev        # build deps, watch + run Nest on :3000
pnpm --filter @reputo/api test       # unit (Vitest)
pnpm --filter @reputo/api test:e2e   # e2e (separate Vitest config)

# TypeORM migrations (DataSource: src/persistence/data-source.ts)
pnpm --filter @reputo/api typeorm:generate src/persistence/migrations/<Name>
pnpm db:migrate                      # apply pending migrations (from repo root)
```
