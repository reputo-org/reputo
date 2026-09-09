# Data model

The application database is PostgreSQL, owned by `@reputo/api`, and managed with TypeORM. The entities and migrations are the source of truth; this page is a quick map.

Two other stores live outside this database:

- On-chain transfers, a separate Postgres owned by [`@reputo/onchain-data`](../packages/onchain-data/README.md).
- Deep Funding Portal data, a per-snapshot SQLite file owned by [`@reputo/deepfunding-portal-api`](../packages/deepfunding-portal-api/README.md).

Entities live in [`apps/api/src/persistence/entities/`](../apps/api/src/persistence/entities). Migrations live in [`apps/api/src/persistence/migrations/`](../apps/api/src/persistence/migrations).

## Enums

| Type | Values |
| --- | --- |
| `snapshot_status` | `queued`, `running`, `completed`, `failed`, `cancelled` |
| `snapshot_publication_status` | `pending`, `sent`, `failed` |
| `community_platform` | `discord`, `github`, `mattermost` |
| `community_connection_status` | `pending`, `active`, `degraded`, `broken`, `disconnected` |
| `oauth_provider` | `deep-id` |
| `access_role` | `owner`, `admin` |

## Algorithms and snapshots

| Table | What it holds |
| --- | --- |
| `algorithm_presets` | A saved algorithm configuration: `key`, `version`, `name`, `description`. |
| `algorithm_preset_inputs` | One row per input of a preset: `key`, JSONB `value`, `position`. Unique per `(preset, key)`. Deleted with the preset. |
| `snapshots` | One run of a preset: `status`, the frozen preset (`algorithm_preset_frozen`), Temporal metadata, an optional `error`, `started_at`, `completed_at`. A preset with snapshots cannot be deleted. |
| `snapshot_outputs` | The results of a snapshot as `key` / `value` pairs. Unique per `(snapshot, key)`. |
| `snapshot_publications` | One DeepID publication record per `(snapshot, algorithm_key)`: `status`, the posting `counts` (JSONB), a safe `error`. Written by the workflow through the API activities queue. |

## Community connections

| Table | What it holds |
| --- | --- |
| `community_connections` | One connected community: `platform`, `external_id` (guild id, installation id, or `origin/teamId`), `name`, `status`, JSONB `settings` (the last check and display metadata), and `credentials_ciphertext` for sealed Mattermost tokens. Unique per `(platform, external_id)`. Triggers notify `community_connection_updates` on changes a client can see. |
| `community_connection_audit` | One row per action on a connection: `connection_id`, `platform`, `actor_user_id` (null for system checks), `action`, `outcome`, `error_category`, `created_at`. |

## Identity and access

| Table | What it holds |
| --- | --- |
| `oauth_users` | A person who signed in through OIDC: provider, subject `sub`, profile claims. Unique per `(provider, sub)`. |
| `auth_sessions` | An app session: encrypted access and refresh tokens, their expiry, the granted `scope`, PKCE `state` and `code_verifier`. |
| `oauth_consent_grants` | A short-lived consent flow started outside login (the Voting Portal grant): `source`, PKCE state, `expires_at`. Removed after the callback. |
| `access_allowlist` | Who can sign in and as what: `email`, `role`, who invited or revoked the entry. Unique per `(provider, email)`. |

## Change the schema

1. Change the entity under `apps/api/src/persistence/entities/`.
2. Add a TypeORM migration under `apps/api/src/persistence/migrations/` with a working `down()`. CI applies, reverts, and re-applies every migration.
3. Apply it locally with `pnpm db:migrate`.
