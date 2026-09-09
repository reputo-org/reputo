# @reputo/api

NestJS API for Reputo. It owns the application PostgreSQL database and hosts the Temporal worker for database activities.

## What it does

Routes are versioned under `/api/v1`:

| Route group | Purpose |
| --- | --- |
| `/auth/*` | DeepID OIDC login, session, logout. |
| `/admins/*` | The access allowlist (owners only). |
| `/algorithm-presets` | Preset CRUD. |
| `/snapshots`, `/snapshots/events` | Snapshot create, list, get, delete, and the SSE stream. |
| `/community/connections/*`, `/community/events` | Connect Discord, GitHub, and Mattermost, list resources, re-check, disconnect, and the SSE stream. |
| `/community/webhooks/github` | Signed GitHub App deliveries. The only community route without a session. |
| `/oauth/consent/*` | The Voting Portal consent flow. |
| `/storage/*` | Upload verification, presigned downloads, attachment streaming. |

The protected API reference is available outside the version prefix at `/reference` and `/docs`.

The Temporal worker on the `api-snapshot-activities` queue exposes `getSnapshot`, `updateSnapshot`, `getCommunityConnection`, `getCommunitySealedCredential`, `checkCommunityConnectionHealth`, and `recordSnapshotPublication` to the orchestrator.

## Run locally

```bash
pnpm --filter @reputo/api dev          # build deps, watch and run Nest
pnpm --filter @reputo/api build
pnpm --filter @reputo/api start
pnpm --filter @reputo/api test
pnpm --filter @reputo/api test:e2e     # needs Docker
pnpm --filter @reputo/api typecheck
```

Local development listens on <http://localhost:3000>.

## Configuration

The API validates its environment in [`src/config/env.ts`](src/config/env.ts): the database, DeepID OIDC and consent settings, storage, Temporal, and the community platform credentials. The full list is in the root [`.env.example`](../../.env.example).

## Database

TypeORM owns the schema. Entities live under `src/persistence/entities/`, migrations under `src/persistence/migrations/`. The SSE streams are driven by PostgreSQL `LISTEN/NOTIFY` on `snapshot_updates` and `community_connection_updates`. Run migrations from the repo root with `pnpm db:migrate`.

## Related documentation

- [Documentation](../../docs/README.md)
- [Data model](../../docs/data-model.md)
- [Community connections](../../docs/community-connections.md)
