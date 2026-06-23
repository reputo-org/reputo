# @reputo/deep-id-api

Framework-agnostic client for the DeepID Client API over the machine-to-machine
(OAuth 2.0 client-credentials) path. No framework, no database — pure HTTP.

It exists so Reputo can read consented users (`GET /v1/users`) and post computed
reputation scores back (`POST /v1/clients/scores`) using a single cached M2M token.

Public API is `src/index.ts`: `createDeepIdClient(config)` returns a client with
`getUsers` / `iterateUsers` (paginated via the `x-next` cursor) and `postScores`.
Token management (cache + refresh-before-expiry + single-flight + 401 retry) lives
in `src/api/token.ts`; transport + retry/backoff in `src/api/http.ts`.

Config is passed to the factory (no `process.env` reads here) — the consuming app
validates env and passes values in, mirroring `packages/deepfunding-portal-api`.
