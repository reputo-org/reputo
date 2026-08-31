# @reputo/community-api

Framework-agnostic, read-only clients for the community platforms Reputo scores.
No framework, no database, no `process.env` — the consuming app validates its
env and passes the values to the client factory.

Public API is `src/index.ts`. `src/shared` holds the transport (undici, retry
with exponential backoff and jitter, `retry-after` wins on a 429) and the typed
errors every platform maps onto: `CommunityAuthError`,
`CommunityPermissionError`, `CommunityRateLimitError`, `CommunityNetworkError`,
`CommunityHttpError`, `CommunityContractError`. Each carries a safe
`CommunityErrorCategory` — callers persist the category, never a response body.

Per platform, transport (`client.ts`) stays separate from transformation
(`transform.ts`, pure functions) so tests cover the mapping without network.

Rules that outrank convenience here:

- Never fetch or store message content. The probe reads one page to verify
  permission and keeps only counts and field presence.
- Bot tokens and client secrets are arguments, never persisted and never
  logged. The transport logs a method, a query-stripped URL, and a status code.
- The Discord bot asks for View Channels and Read Message History only, and no
  privileged intents — the probe verifies field availability under that limit.
- The GitHub App private key never leaves the process: it signs a short-lived
  app JWT, which mints installation tokens that live in memory for the run. Only
  installation responses move the rate-limit snapshot the crawl throttles on;
  the App's own budget is a different bucket.
