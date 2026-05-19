# Komodo Resources

This directory contains the declarative Komodo resources for Reputo. Core syncs
the tree from the `main` branch through the `reputo-main` ResourceSync in
`_sync.toml`.

## Layout

- `_sync.toml` defines the ResourceSync itself. `managed = false` and
  `delete = false` keep sync execution reviewable and non-destructive.
- `servers.toml` defines the staging and production Periphery servers.
- `stacks/infra.toml` defines staging and production infra stacks from
  `docker/compose/infra.yml` plus `docker/compose/observability.yml`.
- `stacks/apps.toml` defines staging and production app stacks from
  `docker/compose/apps.yml`.
- `procedures/promote-production.toml` defines the manual production deploy
  procedure used after GitHub Actions promotes image tags.
- `user-groups.toml` defines the `admins`, `engineers`, and
  `release-managers` RBAC groups.
- `variables.toml` declares every Komodo variable and secret name used by the
  stacks. Values stay in the Komodo UI; this file only provisions the shells.
- `alerters/discord.toml` defines the Discord alerter.
- `schedules/prune-images.toml` defines a scheduled Procedure. Komodo schedules
  are stored on Procedures or Actions, not as standalone `[[schedule]]`
  resources.

## Stack Posture

The Stack resources clone `reputo-org/reputo` from the `main` branch and reuse
the split Compose files instead of duplicating Compose YAML into Komodo. The
target hosts no longer need an `/opt/reputo` checkout for normal deploys.

The staging app stack is authoritative for staging deploys:
`poll_for_updates = false`, `webhook_enabled = true`,
`webhook_force_deploy = true`, and `deploy = false`. GitHub Actions POSTs to
the staging Stack webhook after a successful image build so mutable `staging`
tags are deployed with `compose pull && up -d`.

The production app stack has direct stack webhooks disabled. GitHub Actions
performs the digest-based production retag, then calls the
`promote-production` Procedure webhook so Komodo runs `DeployStack` for
`reputo-apps-production`. Infra stacks keep polling and webhooks disabled.

Each stack writes a Komodo-managed env file at deploy time from the TOML
`environment` block:

- `.komodo-reputo-infra-staging.env`
- `.komodo-reputo-infra-production.env`
- `.komodo-reputo-apps-staging.env`
- `.komodo-reputo-apps-production.env`

Those files are generated on the target host and are passed to Docker Compose
with `--env-file`. The checked-in TOML references Komodo variables and secrets
only by `[[NAME]]`; resolved values must not be committed.

The app stack environments deliberately keep the existing channel tags:

- staging app stack sets `IMAGE_TAG=staging`
- production app stack sets `IMAGE_TAG=production`

Production and staging Compose files do not load `docker/env/*.env`. Runtime
configuration is provided by the Komodo-generated stack env file and wired into
services with explicit `environment` entries. `docker/env/examples/*.env.example`
remain local/emergency references only.

The infra stack does not require a host-provisioned MongoDB keyfile. MongoDB
generates its replica-set keyfile on first startup and persists it in the
`mongodb_keyfile` Docker volume on the target host.

Deploy the infra stack before the apps stack. The apps Compose file is valid as
a standalone Komodo stack and therefore does not declare `depends_on`
relationships to services owned by the infra stack.

## RBAC

`_sync.toml` has `include_user_groups = true`, so the three UserGroups in
`user-groups.toml` are part of the resource sync. Keep individual user
membership out of Git and manage membership in the Komodo UI after the groups
exist.

Permission matrix:

| Group | Permissions |
| --- | --- |
| `admins` | `Write` on managed Reputo Servers, Stacks, Procedures, Alerters, and ResourceSyncs |
| `engineers` | `Execute` on staging stacks; `Read` on production server, production stacks, and `promote-production` |
| `release-managers` | `Execute` on `promote-production`; `Read` on the production server and production app stack |

Komodo platform admin status is separate from the `admins` UserGroup and is
still granted by a super admin in the UI.

## Required Komodo Variables And Secrets

The names below are provisioned automatically through `variables.toml` when the
sync runs with `include_variables = true`. After the first sync creates the
shells, fill the values in the Komodo UI under `Settings > Variables`, then
flip `include_variables` back to `false` in `_sync.toml` so subsequent syncs
do not flag value diffs as pending.

- `KOMODO_PASSKEY`
- `KOMODO_WEBHOOK_SECRET`
- `KOMODO_DISCORD_WEBHOOK_URL`
- `STAGING_PERIPHERY_ADDRESS`
- `PRODUCTION_PERIPHERY_ADDRESS`

For each environment prefix, `STAGING` and `PRODUCTION`, create these
non-secret variables:

- `<ENV>_TRAEFIK_DOMAIN`
- `<ENV>_UI_DOMAIN`
- `<ENV>_API_DOMAIN`
- `<ENV>_TEMPORAL_UI_DOMAIN`
- `<ENV>_GRAFANA_DOMAIN`
- `<ENV>_ALLOWED_ORIGINS`
- `<ENV>_GRAFANA_ADMIN_USER`
- `<ENV>_OWNER_EMAIL`
- `<ENV>_APP_PUBLIC_URL`
- `<ENV>_MONGODB_DB_NAME`
- `<ENV>_DEEP_ID_ISSUER_URL`
- `<ENV>_DEEP_ID_CLIENT_ID`
- `<ENV>_DEEP_ID_AUTH_REDIRECT_URI`
- `<ENV>_DEEP_ID_AUTH_SCOPES`
- `<ENV>_DEEP_ID_CONSENT_REDIRECT_URI`
- `<ENV>_DEEP_ID_CONSENT_GRANT_TTL_SECONDS`
- `<ENV>_VOTING_PORTAL_RETURN_URL`
- `<ENV>_DEEP_ID_VOTING_PORTAL_SCOPES`
- `<ENV>_AUTH_COOKIE_DOMAIN`
- `<ENV>_AWS_REGION`
- `<ENV>_STORAGE_BUCKET`
- `<ENV>_DEEPFUNDING_API_BASE_URL`
- `<ENV>_ONCHAIN_DATA_POSTGRES_DB_NAME`

`<ENV>_OWNER_EMAIL` is required while the app stack runs `AUTH_MODE=oauth`.
If it is missing, or if it does not match the existing active owner allowlist
row, the API fails startup.

For each environment prefix, `STAGING` and `PRODUCTION`, create these secrets:

- `<ENV>_TRAEFIK_AUTH`
- `<ENV>_CF_DNS_API_TOKEN`
- `<ENV>_GRAFANA_AUTH`
- `<ENV>_MONGODB_USER`
- `<ENV>_MONGODB_PASSWORD`
- `<ENV>_TEMPORAL_POSTGRES_USER`
- `<ENV>_TEMPORAL_POSTGRES_PASSWORD`
- `<ENV>_ONCHAIN_DATA_POSTGRES_USER`
- `<ENV>_ONCHAIN_DATA_POSTGRES_PASSWORD`
- `<ENV>_GRAFANA_ADMIN_PASSWORD`
- `<ENV>_DEEP_ID_CLIENT_SECRET`
- `<ENV>_AUTH_TOKEN_ENCRYPTION_KEY`
- `<ENV>_DEEPFUNDING_API_KEY`
- `<ENV>_ALCHEMY_API_KEY`
- `<ENV>_BLOCKFROST_API_KEY`

Store htpasswd-style values such as `<ENV>_TRAEFIK_AUTH` and
`<ENV>_GRAFANA_AUTH` with the doubled `$$` escaping preserved exactly as it
appears in the current Compose env files.

Configure the GHCR PAT in Komodo under `Settings > Providers` as a Docker
registry account for `ghcr.io`. Attach that registry account to the stacks if
image pulls require authentication; do not model the PAT as a stack
environment variable.

Recommended tags:

- `env:staging` or `env:production`
- `scope:cloudflare`, `scope:traefik`, `scope:grafana`, `scope:mongodb`,
  `scope:postgres`, `scope:aws`, `scope:deep-id`, `scope:deepfunding`,
  `scope:onchain`, or `scope:ghcr`

Cutover order for secrets and RBAC:

1. With `include_variables = true`, run the sync once to create variable and
   secret shells, then fill values in the Komodo UI and flip
   `include_variables` back to `false`.
2. Sync resources and UserGroups.
3. Add users to the appropriate UserGroups in the UI.
4. Deploy through Komodo and confirm all services start.
5. Compare selected container env values before and after migration without
   printing secrets to logs.
6. Manually delete or disable the old `slack` Alerter in Komodo if it already
   exists; ResourceSync has `delete = false`.
7. Remove any prod/staging dependence on host `docker/env/*.env` files.
8. Keep `docker/env/examples/*.env.example` aligned with the Compose
   environment contract.

Keep secrets in Komodo or the password manager only. Do not commit resolved
values.

## Webhooks

GitHub Actions calls the staging Stack webhook at:

```text
https://komodo.logid.xyz/listener/github/stack/reputo-apps-staging/deploy
```

Configure the GitHub `staging` environment secret `KOMODO_WEBHOOK_SECRET` with
the same value as Komodo Core. The workflow remains gated on
`affected-count != '0'`; use a no-op change in a deployable app workspace for
validation rather than an empty commit.

The production promotion workflow calls:

```text
https://komodo.logid.xyz/listener/github/procedure/promote-production/__ANY__
```

Configure the GitHub `production` environment secret `KOMODO_WEBHOOK_SECRET`
with the same value as Komodo Core.

## Validation Checklist

- Execute the ResourceSync and confirm it creates or updates the three
  UserGroups.
- As an `engineers` member, execute `reputo-apps-staging`.
- As an `engineers` member, confirm `promote-production` cannot be executed.
- As a `release-managers` member, execute `promote-production`.
- Confirm `reputo-apps-production` has direct stack webhooks disabled.
- Trigger a Discord test alert from Komodo.
- Promote a known `sha-<commit>` with
  `.github/workflows/promote-production.yml` and confirm Komodo deploys
  `reputo-apps-production`.
- Promote a missing SHA and confirm the workflow fails before retagging or
  calling Komodo.
- Confirm the Komodo audit log shows the production Procedure run and the
  promoted commit SHA from the webhook payload.
