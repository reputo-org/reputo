# Activity Code Instructions

- Activities own the side effects that workflows cannot: DB, network, storage, filesystem, randomness, and wall-clock reads.
- Keep activity inputs and outputs explicit and serializable; workflows pass them across replay boundaries.
- Use the Temporal activity `Context` for logging, heartbeats, and cancellation; do not invent parallel logging or cancellation channels.
- Make activities idempotent where retries are possible, or document why they cannot be.
- Translate external errors into typed errors from `src/shared/errors` so workflows can branch on intent, not on stack traces.
- When activity behavior or signatures change, update the corresponding activity tests and the shared types they flow through.
