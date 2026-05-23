# Activity Code Instructions

- Activities own the side effects that workflows cannot: network, storage, filesystem, randomness, and wall-clock reads.
- Application-database reads and writes are owned by the API. Do not open a DB client here — invoke the API's snapshot activities (`getSnapshot`, `updateSnapshot`) on the `api-snapshot-activities` task queue (`API_SNAPSHOT_ACTIVITIES_TASK_QUEUE` from `@reputo/contracts`) from the orchestrator workflow.
- Keep activity inputs and outputs explicit and serializable; workflows pass them across replay boundaries.
- Use the Temporal activity `Context` for logging, heartbeats, and cancellation; do not invent parallel logging or cancellation channels.
- Make activities idempotent where retries are possible, or document why they cannot be.
- Translate external errors into typed errors from `src/shared/errors` so workflows can branch on intent, not on stack traces.
- When activity behavior or signatures change, update the corresponding activity tests and the shared types they flow through.
