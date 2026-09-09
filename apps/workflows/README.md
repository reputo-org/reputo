# @reputo/workflows

Temporal workers that orchestrate snapshots and run the algorithms.

## What it does

- **Orchestrator worker** resolves snapshot dependencies, runs the algorithm, and posts scores to DeepID.
- **Algorithm worker** runs the TypeScript compute functions and reads or writes snapshot data through S3.
- **Onchain-data worker** resolves the `onchain-data` dependency on its own task queue.
- **Community worker** resolves `discord-activity`, `github-activity`, and `mattermost-activity`: it crawls the selected channels or repositories and freezes them as a Parquet dataset under the snapshot prefix. It runs one fetch at a time, so community snapshots queue up.

The workers run all algorithms in the registry. See [Reputation algorithms](../../docs/reputation-algorithms.md) and [Community algorithms](../../docs/community-algorithms.md).

## Persistence boundary

Workers never open the application database. Snapshot and connection reads and writes go through the activities the API hosts on the `api-snapshot-activities` queue, defined in [`@reputo/contracts`](../../packages/contracts). To add persistence behaviour, add the activity in [`apps/api`](../api), publish its types in `@reputo/contracts`, and call it from the orchestrator.

## Run locally

```bash
pnpm --filter @reputo/workflows dev                       # build deps, watch all four workers
pnpm --filter @reputo/workflows dev:orchestrator          # one worker at a time: dev:algorithm-typescript, dev:onchain-data, dev:community
pnpm --filter @reputo/workflows build
pnpm --filter @reputo/workflows start:orchestrator        # also start:algorithm-typescript, start:onchain-data, start:community
pnpm --filter @reputo/workflows test
pnpm --filter @reputo/workflows typecheck
```

## Configuration

The workers validate their environment in [`src/config/env.ts`](src/config/env.ts): Temporal, storage, DeepFunding, DeepID, the onchain-data Postgres URL, and the community platform credentials. The full list is in the root [`.env.example`](../../.env.example).

## Related documentation

- [Documentation](../../docs/README.md)
- [DeepID integration](../../docs/deep-id-integration.md)
- [Local development](../../docs/local-development.md)
