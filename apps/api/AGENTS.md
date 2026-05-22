# API Instructions

- Keep Nest features layered: controllers map HTTP, services own business logic, repositories own persistence and queries.
- Follow the existing feature structure: `*.controller.ts`, `*.service.ts`, `*.repository.ts`, `dto/`, and `*.module.ts`.
- Validate inbound request data at the DTO boundary using the existing Nest validation patterns.
- Keep HTTP concerns at the edge. Services may raise domain errors; controllers and filters should translate them into HTTP responses.
- When endpoint behavior or request/response contracts change, update the relevant unit or e2e tests.

## Persistence

- Persistence lives in `src/persistence` (TypeORM `DataSource`, entity definitions, and the LISTEN/NOTIFY listener) plus per-feature repositories. The API owns the application database; no other workspace opens a connection to it.
- ORM is **TypeORM** via `@nestjs/typeorm`. The naming strategy is `SnakeNamingStrategy` (snake_case at the DB layer, camelCase in entities); avoid sprinkling per-column `@Column({ name: ... })` overrides.
- Prefer the repository layer over raw `Repository<Entity>` / `DataSource` access from services so query intent stays testable.
- Snapshot real-time updates use PostgreSQL `LISTEN/NOTIFY` on `snapshot_updates`. Always pair a snapshot mutation with the matching `pg_notify` in the same transaction (use `manager.query('SELECT pg_notify($1, $2)', [SNAPSHOT_UPDATES_CHANNEL, id])` inside the surrounding `dataSource.transaction(...)`).
- Multi-table writes use `dataSource.transaction(async (manager) => { ... })`; never call repositories from two unrelated contexts inside one logical write.
- Entity files live under `src/persistence/entities/`. The standalone CLI DataSource for migrations is `src/persistence/data-source.ts`. Migrations live under `src/persistence/migrations/`. Generate a new migration with `pnpm --filter @reputo/api typeorm:generate src/persistence/migrations/<Name>` and apply it with `pnpm --filter @reputo/api typeorm:run`. `synchronize: true` is forbidden outside test fixtures.

## Temporal worker

- The API hosts a Temporal worker on the `api-snapshot-activities` task queue (`API_SNAPSHOT_ACTIVITIES_TASK_QUEUE` in `@reputo/contracts`).
- Wire any new cross-service activity here: add the activity implementation under `src/temporal`, expose its I/O type in `@reputo/contracts`, and register it on the API worker. Workflows pull DB-touching work through this queue.
- Activity I/O DTOs stay framework-agnostic in `@reputo/contracts` so Workflows can import them without dragging Nest in.
