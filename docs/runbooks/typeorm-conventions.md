# TypeORM Conventions

How persistence-owning workspaces in this monorepo wire TypeORM, write entities, and ship schema changes. Applies to `@reputo/api`, `@reputo/onchain-data`, and `@reputo/deepfunding-portal-api`. Cross-link this doc rather than re-deriving the patterns in each PR.

## NestJS integration (API)

`@reputo/api` is the only persistence-owning NestJS workspace. Wire TypeORM through `@nestjs/typeorm` as the [official docs](https://docs.nestjs.com/techniques/database#typeorm-integration) describe:

- Register the root `DataSource` once via `TypeOrmModule.forRootAsync` in a global `PersistenceModule`. Inject `ConfigService`; do not read `process.env` at module construction time.
- Each feature module imports `TypeOrmModule.forFeature([Entity, ChildEntity])` and injects repositories via `@InjectRepository(Entity) private readonly repo: Repository<Entity>`.
- Repositories own queries; services own business logic; controllers own HTTP shape. Do not reach `DataSource` directly from controllers.

Reference: [apps/api/src/persistence/typeorm.module.ts](../../apps/api/src/persistence/typeorm.module.ts).

## DataSource (apps and packages)

Each persistence-owning workspace exports one `data-source.ts` shared by the runtime DataSource registration and the TypeORM CLI (`migration:generate`, `migration:run`). This keeps the SQL the CLI generates aligned with what the app opens at boot. `synchronize: false` everywhere except tests.

- API: [apps/api/src/persistence/data-source.ts](../../apps/api/src/persistence/data-source.ts)
- deepfunding-portal-api: [packages/deepfunding-portal-api/src/db/data-source.ts](../../packages/deepfunding-portal-api/src/db/data-source.ts)

`@reputo/onchain-data` predates this pattern: it uses `EntitySchema` plus `dataSource.synchronize()` under an advisory lock from `client.ts` for its ephemeral sync workloads. New persistence code should follow the `data-source.ts` + migrations pattern.

## Naming

- `SnakeNamingStrategy` (from `typeorm-naming-strategies`) at the DB layer; camelCase fields in entity classes. No per-column `@Column({ name: ... })` overrides.
- Plural table names: `algorithm_presets`, `snapshots`, `oauth_users`.
- FKs follow `<table_singular>_id`: `algorithm_preset_id`, `snapshot_id`.
- Timestamps via `@CreateDateColumn` / `@UpdateDateColumn` named `createdAt` / `updatedAt` (snake-cased by the strategy to `created_at` / `updated_at`).

## Primary keys

UUID v7 strings end-to-end. Generate in app code with `uuid`'s `v7()` from a `@BeforeInsert()` hook; declare the column with `@PrimaryColumn({ type: 'uuid' })`. Do not rely on DB-side defaults.

```ts
@PrimaryColumn({ type: 'uuid' })
id!: string;

@BeforeInsert()
generateId(): void {
  if (!this.id) this.id = uuidv7();
}
```

`@reputo/onchain-data` uses composite text PKs (`chain` / `asset_identifier` / `unique_id`) because rows mirror external provider keys; that is intentional and stays.

## Enums

- PostgreSQL: `@Column({ type: 'enum', enum: SOME_ENUM, enumName: 'some_enum' })`. Source the values from `@reputo/contracts` so the API and Workflows agree.
- SQLite: there is no native enum. Use `@Column({ type: 'varchar' })` with a TS union or string-literal type.

## JSON vs relational

- `jsonb` (PG) / `simple-json` (SQLite) for opaque blobs: point-in-time snapshots (`algorithm_preset_frozen`), error payloads (`error`), Temporal metadata (`temporal`), and provider mirrors (`raw_json`, `metadata`).
- Normalize repeated key-value lists into child tables. The canonical example is the API's `algorithm_preset_inputs` and `snapshot_outputs` tables — each child row carries a `position`, a `key`, and a typed `value` column, so the parent stays queryable and indexable.
- Rule of thumb: if a value will ever be queried, indexed, or counted, do not bury it in a `jsonb` blob.

## Arrays

- PostgreSQL: `@Column({ type: 'text', array: true })` for native set-shaped fields (e.g., OAuth `aud`, `scope`).
- SQLite: `simple-array` for short joined-string lists; otherwise model as a child table.

## Migrations

- Generate from entity diffs:

  ```bash
  pnpm --filter @reputo/api typeorm:generate src/persistence/migrations/<Name>
  ```

- Apply with `pnpm --filter <workspace> typeorm:run` (deploys) and `typeorm:revert` to roll back the last migration. The CLI commands are wired to each workspace's `data-source.ts`.
- **Never enable `synchronize: true` outside tests** (per the NestJS docs). TypeORM will silently mutate the schema on entity change.

`@reputo/onchain-data` is the lone `synchronize`-based workspace; that is acceptable for its ephemeral sync workloads but is not the model for new code.

## Tests

- API: `@testcontainers/postgresql` boots a real Postgres in test bootstrap, and the suite runs `dataSource.runMigrations()` so tests exercise the same SQL production runs.
- deepfunding-portal-api: a temp SQLite file (or `:memory:`) per `createDb` call, with migrations run on init.

Tradeoff: migrations-in-bootstrap catches migration bugs but is slower than `synchronize: true`. Default to migrations-for-parity; only switch a suite to `synchronize: true` if the slowdown is materially blocking the inner loop, and leave a comment in the test util.

## Transactions

Multi-table writes go through `dataSource.transaction(async (manager) => { ... })`. Use `manager.getRepository(Entity)` inside the callback; do not reach back to the injected per-feature repositories from within the transaction.

```ts
await this.dataSource.transaction(async (manager) => {
  await manager.getRepository(SnapshotEntity).save(snapshot);
  await manager.getRepository(SnapshotOutputEntity).save(outputs);
  await manager.query('SELECT pg_notify($1, $2)', [SNAPSHOT_UPDATES_CHANNEL, snapshot.id]);
});
```

Raw SQL inside a transaction (e.g., the snapshot `NOTIFY`) uses `manager.query(...)` so it runs on the same connection and inherits the same atomicity.

## Pagination

Use the shared helper in [apps/api/src/shared/persistence/pagination.ts](../../apps/api/src/shared/persistence/pagination.ts). It wraps `Repository.findAndCount()` and maps `[items, total]` into the API's standard envelope:

```ts
{ results, page, limit, totalPages, totalResults }
```

Repositories should call `paginate(...)` rather than re-implementing the math; HTTP DTOs expect this exact shape.

## Reference files

- API persistence module: [apps/api/src/persistence/typeorm.module.ts](../../apps/api/src/persistence/typeorm.module.ts)
- API DataSource (CLI + runtime parity): [apps/api/src/persistence/data-source.ts](../../apps/api/src/persistence/data-source.ts)
- API entity with relations and enums: [apps/api/src/persistence/entities/snapshot.entity.ts](../../apps/api/src/persistence/entities/snapshot.entity.ts)
- API normalization pattern: [apps/api/src/persistence/entities/snapshot-output.entity.ts](../../apps/api/src/persistence/entities/snapshot-output.entity.ts)
- API pagination helper: [apps/api/src/shared/persistence/pagination.ts](../../apps/api/src/shared/persistence/pagination.ts)
- deepfunding-portal-api SQLite DataSource: [packages/deepfunding-portal-api/src/db/data-source.ts](../../packages/deepfunding-portal-api/src/db/data-source.ts)
- onchain-data `EntitySchema` variant: [packages/onchain-data/src/adapters/evm/transfers/schema.ts](../../packages/onchain-data/src/adapters/evm/transfers/schema.ts)
