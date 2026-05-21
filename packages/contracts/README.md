# @reputo/contracts

Cross-service contracts shared between the Reputo **API** (`apps/api`) and the
**Workflows** Temporal worker (`apps/workflows`).

The package is intentionally narrow. It contains only:

- **Enums** that travel across the wire (`SnapshotStatus`, `OAuthProvider`,
  `AccessRole`, `AuthSessionPrivateField`).
- **Wire DTOs** — JSON-serializable shapes used as message payloads
  (`SnapshotDto`, `AlgorithmPresetFrozenDto`).
- **Temporal activity I/O** — input/output types for the API-hosted snapshot
  activities (`GetSnapshotInput`, `GetSnapshotOutput`, `UpdateSnapshotInput`)
  together with the `ApiSnapshotActivities` interface.
- **Temporal task-queue names** — `API_SNAPSHOT_ACTIVITIES_TASK_QUEUE`, the
  task queue the API's activity worker registers against and the orchestrator
  workflow proxies activities to.

## Boundary rules

- No `@nestjs/*`, `mongoose`, or `@temporalio/*` runtime dependencies — this
  package is plain TypeScript so both apps can consume it without dragging in
  framework code.
- The API owns persistence (Prisma). Persistence types do **not** belong here.
- Workflows depend on this package only — never on `apps/api` internals.
- Public surface is `src/index.ts`. Do not deep-import.

## Commands

```bash
pnpm --filter @reputo/contracts build
pnpm --filter @reputo/contracts test
pnpm --filter @reputo/contracts typecheck
pnpm --filter @reputo/contracts docs
```

## Docs

- Generated API docs: [docs/README.md](docs/README.md)
