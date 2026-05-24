# Workflows Instructions

- Keep runtime boundaries clear: `src/workflows` coordinates, `src/activities` performs side effects, `src/workers` bootstraps workers, and `src/shared` holds shared types and helpers.
- Put network, storage, and other external I/O in activities, not in workflow orchestration.
- Keep activity inputs and outputs explicit, and handle retries, timeouts, and cancellation intentionally.
- When orchestration or activity behavior changes, update the corresponding workflow or activity tests.

## Environment

- `src/config/env.ts` is the single source of truth for this app's environment.
- Never read `process.env.*` outside that module.
- Adding or changing an env var: see the root [AGENTS.md](../../AGENTS.md) "Environment variables" section.

## Persistence boundary

- The workflows worker has no direct access to the application database. Snapshot reads and writes are proxied to the API via Temporal activities on the `api-snapshot-activities` task queue (`API_SNAPSHOT_ACTIVITIES_TASK_QUEUE` in `@reputo/contracts`).
- If a workflow needs new persistence behavior, add the activity in `apps/api`, publish its I/O types in `@reputo/contracts`, and call it from the orchestrator. Do not introduce a DB client or ORM here.
- Cross-service wire types come from `@reputo/contracts` only. Deep imports from `apps/api` are not allowed.
