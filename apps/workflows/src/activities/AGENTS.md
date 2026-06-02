# activities/

The side-effecting layer. Activities hold everything workflow code cannot: network calls, S3 storage,
filesystem, randomness, wall-clock reads, and the algorithm compute functions. Temporal retries and
times them out, so they are written to be idempotent where retries are possible.

Application-database access does not happen here — the orchestrator calls the API's `getSnapshot` /
`updateSnapshot` activities for that. External failures are translated into typed errors from
`src/shared/errors` so workflows can branch on intent rather than stack traces.

Tests live under `tests/unit/activities`; run with `pnpm --filter @reputo/workflows test`.
