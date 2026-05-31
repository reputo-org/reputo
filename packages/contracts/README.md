# @reputo/contracts

Cross-service contracts shared between the Reputo API (`apps/api`) and the Workflows Temporal worker (`apps/workflows`).

The package is intentionally narrow — plain TypeScript only, no framework runtime dependencies — so both apps can consume it without dragging in framework code.

## What it exports

- **Enums** that travel across the wire: `SnapshotStatus`, `OAuthProvider`, `AccessRole`, `AuthSessionPrivateField`.
- **Wire DTOs** — JSON-serialisable shapes used as message payloads: `SnapshotDto`, `AlgorithmPresetFrozenDto`.
- **Temporal activity I/O** — input/output types for the API-hosted snapshot activities (`GetSnapshotInput`, `GetSnapshotOutput`, `UpdateSnapshotInput`) and the `ApiSnapshotActivities` interface.
- **Task-queue names** — `API_SNAPSHOT_ACTIVITIES_TASK_QUEUE`, the queue the API's activity worker registers against and the orchestrator workflow proxies to.

## Usage

```ts
import {
  API_SNAPSHOT_ACTIVITIES_TASK_QUEUE,
  SnapshotStatus,
  type SnapshotDto,
} from '@reputo/contracts';
```

## Boundary rules

- No `@nestjs/*`, `@prisma/*`, `@typeorm/*`, or `@temporalio/*` runtime dependencies.
- Persistence types do not belong here — the API owns persistence.
- Workflows depend on this package only, never on `apps/api` internals.
- Public surface is `src/index.ts`. Do not deep-import.

## Setup

No runtime configuration.

## Local commands

```bash
pnpm --filter @reputo/contracts build
pnpm --filter @reputo/contracts test
pnpm --filter @reputo/contracts typecheck
pnpm --filter @reputo/contracts docs
```
