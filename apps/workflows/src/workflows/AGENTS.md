# workflows/

The orchestration layer. These files define how a snapshot run proceeds — coordinating activities and
holding the run's state.

Temporal replays this code, so it stays deterministic: no direct network, filesystem, randomness, or
wall-clock reads, and no DB access (all of that is in `activities/`, and DB work is proxied to the API).
Time, signals, queries, cancellation, and activity calls go through Temporal's workflow APIs. Cross-service
activity I/O types come from `@reputo/contracts`.

Tests use the Temporal test environment under `tests/unit/workflows`; run with
`pnpm --filter @reputo/workflows test`. See [../../README.md](../../README.md) and [../../AGENTS.md](../../AGENTS.md).
