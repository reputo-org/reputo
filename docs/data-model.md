# Data model

The application database is the system of record for the platform. It is a PostgreSQL
database owned by `@reputo/api` and managed with TypeORM. This page describes its tables.

Two other stores live outside this database and are documented with their packages:

- On-chain transfers — separate Postgres owned by
  [`@reputo/onchain-data`](../packages/onchain-data/README.md).
- DeepFunding Portal ingest — local store owned by
  [`@reputo/deepfunding-portal-api`](../packages/deepfunding-portal-api/README.md).

The schema is created by the initial migration
[`1748000000000-Init.ts`](../apps/api/src/persistence/migrations/1748000000000-Init.ts).
Entities live in [`apps/api/src/persistence/entities/`](../apps/api/src/persistence/entities).

## Enums

| Type | Values |
| --- | --- |
| `snapshot_status` | `queued`, `running`, `completed`, `failed`, `cancelled` |
| `oauth_provider` | `deep-id` |
| `access_role` | `owner`, `admin` |



## Algorithms and snapshots

### `algorithm_presets`

A saved, named configuration of an algorithm. Key columns: `key`, `version`, `name`,
`description`. Indexed by `key`, `version`, and the pair.

### `algorithm_preset_inputs`

The input values for a preset, one row per input. Holds `key`, a JSONB `value`, and
`position`. Foreign key to `algorithm_presets` (cascade on delete). Unique per
`(preset, key)`.

### `snapshots`

One run of a preset. Holds the `status` enum, a frozen JSON copy of the preset
(`algorithm_preset_frozen`), Temporal run metadata (`temporal`), an optional `error`, and
`started_at` / `completed_at`. Foreign key to `algorithm_presets` (restricted on delete,
so a preset with snapshots cannot be deleted).

### `snapshot_outputs`

The results of a snapshot, as `key` / `value` pairs. Foreign key to `snapshots` (cascade
on delete). Unique per `(snapshot, key)`.

## Identity and access

### `oauth_users`

A person who has signed in through an OIDC provider. Stores the provider, the subject
`sub`, and profile claims (`email`, `username`, `picture`, …). Unique per `(provider, sub)`.

### `auth_sessions`

An app session for a signed-in user. Stores **encrypted** access and refresh tokens
(`*_ciphertext`), their expiries, the granted `scope`, and the PKCE `state` /
`code_verifier`. Foreign key to `oauth_users` (cascade). Indexed by `session_id`,
`user_id`, `expires_at`, and `revoked_at`.

### `oauth_consent_grants`

Short-lived consent flows started outside login (for example a voting-portal grant).
Stores `source`, PKCE `state` / `code_verifier`, and `expires_at`. Unique per `state`.

### `access_allowlist`

Who is allowed to sign in, and as what. Stores `email`, `role` (`owner` / `admin`), and
who invited or revoked the entry (`invited_by_user_id`, `revoked_by_user_id`, both
nullable foreign keys to `oauth_users`). Unique per `(provider, email)`.

## Adding a table or column

Change the entity in
[`apps/api/src/persistence/entities/`](../apps/api/src/persistence/entities), add a
TypeORM migration, and apply it with `pnpm db:migrate`. See
[Environment variables](environment-variables.md) for `DATABASE_URL`.
