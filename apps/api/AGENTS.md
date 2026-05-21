# API Instructions

- Keep Nest features layered: controllers map HTTP, services own business logic, repositories own persistence and queries.
- Follow the existing feature structure: `*.controller.ts`, `*.service.ts`, `*.repository.ts`, `dto/`, and `*.module.ts`.
- Validate inbound request data at the DTO boundary using the existing Nest validation patterns.
- Keep HTTP concerns at the edge. Services may raise domain errors; controllers and filters should translate them into HTTP responses.
- When endpoint behavior or request/response contracts change, update the relevant unit or e2e tests.

## Persistence

- Persistence lives in `src/persistence` (Prisma client + listeners) and per-feature repositories. The API owns the application database; no other workspace opens a connection to it.
- Prefer the repository layer over raw `PrismaClient` access from services so query intent stays testable.
- Snapshot real-time updates use PostgreSQL `LISTEN/NOTIFY` on `snapshot_updates`. Always pair a snapshot mutation with the matching `pg_notify` in the same transaction.
- Schema and migration files live in `prisma/`. Add a migration with `pnpm --filter @reputo/api prisma:migrate:dev`; ship it with `pnpm --filter @reputo/api prisma:migrate:deploy`.

## Temporal worker

- The API hosts a Temporal worker on the `api-snapshot-activities` task queue (`API_SNAPSHOT_ACTIVITIES_TASK_QUEUE` in `@reputo/contracts`).
- Wire any new cross-service activity here: add the activity implementation under `src/temporal`, expose its I/O type in `@reputo/contracts`, and register it on the API worker. Workflows pull DB-touching work through this queue.
- Activity I/O DTOs stay framework-agnostic in `@reputo/contracts` so Workflows can import them without dragging Nest in.
