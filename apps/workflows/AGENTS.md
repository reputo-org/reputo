# @reputo/workflows

Temporal workers that run snapshot execution and reputation algorithms off the request path. Three
workers: **orchestrator** (resolves snapshot dependencies and coordinates the run), **algorithm**
(runs TypeScript compute functions, reading/writing snapshot data through S3), and **onchain-data**
(resolves the onchain-data dependency on its own task queue).

The worker has no application-database connection: snapshot reads and writes are proxied to the API's
Temporal activities on the `api-snapshot-activities` task queue (defined in `@reputo/contracts`). That
keeps DB ownership in one place and workflow code free of direct I/O.

Code is split by runtime role: `src/workflows` (deterministic coordination), `src/activities` (side
effects), `src/workers` (bootstraps each worker), `src/shared` (types/helpers), `src/config/env.ts`.
The `workflows/` and `activities/` subtrees each have their own `AGENTS.md`.

## How to run and test

```bash
pnpm --filter @reputo/workflows dev                 # build deps, watch all three workers
pnpm --filter @reputo/workflows dev:orchestrator    # one worker (also dev:algorithm-typescript, dev:onchain-data)
pnpm --filter @reputo/workflows test                # Vitest
```
