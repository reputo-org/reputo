# Workflow Code Instructions

- Workflow code must stay deterministic and replay-safe.
- Do not perform direct network, filesystem, random, or wall-clock operations here. The workflows worker also has no direct DB access — snapshot persistence flows through the API's Temporal activities.
- Use Temporal workflow APIs for timers, cancellation, logging, signals, queries, and activity proxies.
- Keep workflow state explicit and serializable.
- Put all side effects in activities and keep workflow files focused on coordination and state transitions.
- Cross-service activity I/O comes from `@reputo/contracts`; deep imports from `apps/api` are not allowed.
