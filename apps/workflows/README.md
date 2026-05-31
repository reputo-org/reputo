# @reputo/workflows

Temporal workers that orchestrate snapshot execution and run TypeScript algorithms.

## What it does

- **Orchestrator worker** resolves snapshot dependencies and coordinates execution.
- **Algorithm worker** runs TypeScript compute functions and reads or writes snapshot data through S3.
- **Onchain-data worker** resolves the `onchain-data` dependency on its own task queue.

Current TypeScript algorithms: `contribution_score`, `proposal_engagement`, `token_value_over_time`, `voting_engagement`. See [Reputation algorithms](../../docs/reputation-algorithms.md) for how to add a new one.

## Persistence boundary

Workers do **not** open a connection to the application database. Snapshot reads and writes (`getSnapshot`, `updateSnapshot`) are proxied to the API's Temporal worker on the `api-snapshot-activities` task queue, defined in [`@reputo/contracts`](../../packages/contracts).

If a workflow needs new persistence behaviour, add the activity in [`apps/api`](../api), publish its I/O types in `@reputo/contracts`, and call it from the orchestrator. Do not introduce a DB client here.

## Local commands

```bash
pnpm --filter @reputo/workflows dev                       # build deps, watch all three workers
pnpm --filter @reputo/workflows dev:orchestrator          # just the orchestrator
pnpm --filter @reputo/workflows dev:algorithm-typescript  # just the algorithm worker
pnpm --filter @reputo/workflows dev:onchain-data          # just the onchain-data worker

pnpm --filter @reputo/workflows build
pnpm --filter @reputo/workflows start:orchestrator
pnpm --filter @reputo/workflows start:algorithm-typescript
pnpm --filter @reputo/workflows start:onchain-data

pnpm --filter @reputo/workflows test
pnpm --filter @reputo/workflows typecheck
```

## Configuration

The workers validate their environment in [`src/config/env.ts`](src/config/env.ts). Required: Temporal, storage / AWS, DeepFunding, and the onchain-data Postgres URL. The full list is in the root [`.env.example`](../../.env.example).

The onchain-data Postgres instance belongs to [`@reputo/onchain-data`](../../packages/onchain-data) and is independent of the API's application database.

## More

- [Documentation](../../docs/README.md)
- [Reputation algorithms](../../docs/reputation-algorithms.md)
- [Local development](../../docs/local-development.md)
