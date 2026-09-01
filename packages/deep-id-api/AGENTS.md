# @reputo/deep-id-api

Framework-agnostic client for the DeepID Client API over the machine-to-machine
(OAuth 2.0 client-credentials) path. No framework, no database — pure HTTP.

It exists so Reputo can read consented users (`GET /v1/users`, including
encrypted `scores_encr` fields and the `github`/`discord`/`mattermost` social
identities the community algorithms match on), fetch public SEAL/CKKS metadata, and post
computed reputation scores back (`POST /v1/clients/scores` — plaintext child
scores or the final encrypted `custom_score_encr`) using a single cached M2M token.

Public API is `src/index.ts`: `createDeepIdClient(config)` returns a client with
`getUsers` / `iterateUsers` (paginated via the `x-next` cursor), `getSealMetadata`
(resolved against the `appBaseUrl` origin only; redirects rejected), and
`postScores` (validated discriminated union; plaintext `0` is a valid score).
Token management (cache + refresh-before-expiry + single-flight + 401 retry) lives
in `src/api/token.ts`; transport + retry/backoff in `src/api/http.ts`.

Contracts are enforced at runtime with Zod schemas in `src/resources/*/schemas.ts`;
violations throw `DeepIdContractError` (non-retryable, path-only issues). Never
log tokens, score bodies, ciphertext bodies, or secret material. Timestamps are
caller-supplied and must stay fixed per run — the client never generates them,
so retries stay idempotent on the DeepID side.

Config is passed to the factory (no `process.env` reads here) — the consuming app
validates env and passes values in, mirroring `packages/deepfunding-portal-api`.
