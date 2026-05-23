# @reputo/workflows

Temporal workers that orchestrate snapshot execution and run TypeScript algorithms.

## Surface

- orchestrator worker resolves snapshot dependencies and coordinates execution
- algorithm worker runs TypeScript compute functions and reads or writes snapshot data through S3 storage
- onchain-data worker resolves the `onchain-data` dependency on its dedicated task queue
- current TypeScript algorithms: `contribution_score`, `proposal_engagement`, `token_value_over_time`, `voting_engagement`

## Persistence boundary

The workers do **not** open a connection to the application database. Snapshot
reads and writes (`getSnapshot`, `updateSnapshot`) are proxied to the API's
Temporal worker on the `api-snapshot-activities` task queue
(`API_SNAPSHOT_ACTIVITIES_TASK_QUEUE` in `@reputo/contracts`). The orchestrator
workflow imports activity I/O types and the task-queue constant from
`@reputo/contracts`; it never deep-imports `apps/api` internals.

If a workflow needs new persistence behavior, add the activity in `apps/api`,
publish its I/O types in `@reputo/contracts`, and call it from the orchestrator
— do not introduce a DB client here.

## Commands

```bash
pnpm --filter @reputo/workflows build

pnpm --filter @reputo/workflows dev

pnpm --filter @reputo/workflows dev:orchestrator
pnpm --filter @reputo/workflows dev:algorithm-typescript
pnpm --filter @reputo/workflows dev:onchain-data

pnpm --filter @reputo/workflows start:orchestrator
pnpm --filter @reputo/workflows start:algorithm-typescript
pnpm --filter @reputo/workflows start:onchain-data

pnpm --filter @reputo/workflows test
pnpm --filter @reputo/workflows typecheck
```

The public `dev` commands build and watch the shared package dependencies first. `dev:app` and `dev:*:app` are internal app-only processes used by the root monorepo `pnpm dev`.

## Config

Use `apps/workflows/envs.example` as the local reference file. The workers
require Temporal, storage/AWS, DeepFunding, and onchain-data PostgreSQL
settings. The onchain-data PG instance is unrelated to the API's application
database; it belongs to `@reputo/onchain-data`. `pnpm --filter
@reputo/workflows dev` starts all three workers together, while the `dev:*`
commands remain available when you only want one worker.
