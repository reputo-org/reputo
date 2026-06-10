# Komodo operations

[Komodo](https://komo.do) is the deployment control plane for Reputo staging and production. Core runs on a dedicated host at <https://komodo.logid.xyz>. Staging and production hosts run Periphery agents that execute the declared Compose stacks.

```text
GitHub Actions -> GHCR image tags -> Komodo API (pin tag + deploy) -> Periphery -> Docker Compose
```

This page covers operator topics: install, RBAC, variables, API access, and backups. For day-to-day deploys, see [Deployment](deployment.md). The repository layout is under [Files](#files) below.

## Host shape

- Dedicated VM for Komodo Core, separate from staging and production.
- Minimum size: 1 vCPU, 2 GB RAM.
- Docker Engine with the Compose plugin.
- Ports `80/tcp` and `443/tcp` open to the internet.
- Cloudflare DNS record `komodo.logid.xyz` points to the VM public IP.

## Files

- [`infra/komodo/core/docker-compose.komodo.yml`](../infra/komodo/core/docker-compose.komodo.yml) — runs Traefik, Komodo Core, FerretDB, Postgres, and a self-Periphery agent.
- [`infra/komodo/core/core.env.example`](../infra/komodo/core/core.env.example) — non-secret template. Copy to `core.env` on the host and fill values from the password manager.
- [`infra/komodo/periphery/install.sh`](../infra/komodo/periphery/install.sh) — installs the Periphery agent on staging and production hosts.
- [`infra/komodo/resource-sync.toml`](../infra/komodo/resource-sync.toml) — the single `ResourceSync` declaration.
- [`infra/komodo/procedures.toml`](../infra/komodo/procedures.toml) — every Procedure (deploy-*, restart-*, backup-*).
- [`infra/komodo/resources/`](../infra/komodo/resources/) — cross-cutting resources (servers, variables, user-groups, alerters).
- [`infra/komodo/stacks/`](../infra/komodo/stacks/) — one folder per Komodo Stack family. Each folder owns its Stack TOML, Compose file, env contract, and any service configs.

Komodo's Postgres-backed mode runs FerretDB in front of Postgres. Core then talks to a Postgres-backed metadata store through its native document-DB driver.

## Install Core

On the dedicated VM:

```bash
mkdir -p /opt/reputo
cd /opt/reputo

# Get this repository onto the host, then:
cp infra/komodo/core/core.env.example infra/komodo/core/core.env
chmod 600 infra/komodo/core/core.env

# Edit core.env and replace every CHANGE_ME value from the password manager.
sudo mkdir -p \
  /etc/komodo/traefik/certs \
  /etc/komodo/core/data/postgres \
  /etc/komodo/core/data/ferretdb-state \
  /etc/komodo/core/data/keys \
  /etc/komodo/core/data/syncs \
  /etc/komodo/core/data/repo-cache \
  /etc/komodo/core/backups

# FerretDB runs as UID/GID 1000 and must be able to write /state/state.json.
sudo chown -R 1000:1000 /etc/komodo/core/data/ferretdb-state

sudo touch /etc/komodo/traefik/certs/cloudflare-acme.json
sudo chmod 600 /etc/komodo/traefik/certs/cloudflare-acme.json

docker compose \
  -f infra/komodo/core/docker-compose.komodo.yml \
  --env-file infra/komodo/core/core.env \
  up -d
```

## Install Periphery (per host)

```bash
cp infra/komodo/periphery/periphery.env.example infra/komodo/periphery/periphery.env
chmod 600 infra/komodo/periphery/periphery.env

# Edit periphery.env:
# - KOMODO_PASSKEY: same value as Core's KOMODO_PASSKEY
# - PERIPHERY_ALLOWED_IPS: Core IP /32 or VPN CIDR
# - PERIPHERY_PUBLISH_IP: private/VPN host IP reachable from Core

infra/komodo/periphery/install.sh --env-file infra/komodo/periphery/periphery.env
```

Register each host in the Komodo UI:

- Server name: `staging` or `production`.
- Address: `http://<PERIPHERY_PUBLISH_IP>:8120` when `PERIPHERY_SSL_ENABLED=false`.
- Passkey: the same `KOMODO_PASSKEY` used by Core and Periphery.

Verify on the target host:

```bash
docker compose \
  -f /etc/komodo/periphery/docker-compose.yml \
  --env-file /etc/komodo/periphery/periphery.env \
  ps

docker restart komodo-periphery
sleep 30
docker ps --filter name=komodo-periphery --format '{{.Names}} {{.Status}}'
ss -ltnp | grep ':8120'
```

From a network that is not Core or the VPN, `nc -vz <host-public-ip> 8120` must fail. Use the host or cloud firewall to block port 8120 from the public internet. `PERIPHERY_ALLOWED_IPS` is defence in depth, not the public exposure control.

## Resource sync

Core syncs the [`infra/komodo`](../infra/komodo) tree from `main` through the `reputo-main` ResourceSync defined in [`resource-sync.toml`](../infra/komodo/resource-sync.toml). The sync scans `resource-sync.toml`, `procedures.toml`, the `resources/` folder, and the `stacks/` folder (recursing into each `stacks/<name>/stack.toml`). `managed = false` and `delete = false` keep sync runs reviewable and non-destructive.

After merging resource changes:

1. Open Komodo Core.
2. Go to `Resources > Resource Syncs > reputo-main`.
3. Review the pending diff.
4. Execute the sync.

The sync includes UserGroups. Apply the RBAC resources after cutover, then add or remove individual users from groups in the UI. User identities are not hard-coded in this repository.

## Stack model

Reputo runs as four Komodo Stacks per environment. Each Stack is a separate Docker Compose project on the host and joins the shared external bridge network `reputo`. The split is by lifecycle: each datastore (application Postgres, Temporal's cluster, observability TSDBs) gets its own stack so restarting one does not bounce the others, while the stateless apps stack redeploys on every merge. Traefik ships with the apps stack because its routing labels are reissued on each routing change.

- `reputo-database-{env}` — application Postgres + onchain-data Postgres + on-demand `postgres-backup`. Folder: [infra/komodo/stacks/database/](../infra/komodo/stacks/database/).
- `reputo-temporal-{env}` — Temporal server + UI + Postgres (Postgres visibility store). Folder: [infra/komodo/stacks/temporal/](../infra/komodo/stacks/temporal/).
- `reputo-observability-{env}` — Loki/Promtail/Prometheus/cAdvisor/node-exporter/Grafana. Folder: [infra/komodo/stacks/observability/](../infra/komodo/stacks/observability/).
- `reputo-apps-{env}` — Traefik + UI + API + workflow workers. Folder: [infra/komodo/stacks/apps/](../infra/komodo/stacks/apps/).

Posture:

- Both apps stacks deploy through the Komodo API: GitHub Actions sets the stack's `*_IMAGE_TAG` Variable (`UpdateVariableValue`) and triggers `DeployStack`, then waits for the resulting Update to complete. Stack webhooks and polling are disabled (`poll_for_updates = false`, `webhook_enabled = false`, `deploy = false`).
- The production flow additionally retags the `production` / `prod-<commit>` aliases in GHCR before deploying, as an audit trail.
- Database, temporal, and observability stacks have webhooks and polling disabled. They are deployed manually through the `deploy-*` procedures.

At deploy time each stack writes a Komodo-managed env file (`.komodo-reputo-<stack>-{env}.env`) from its TOML `environment` block and passes it to Docker Compose with `--env-file`. The checked-in TOML references variables and secrets by `[[NAME]]` only; resolved values must never be committed.

The apps stacks pin immutable image tags through Variables:

- staging: `IMAGE_TAG=[[STAGING_IMAGE_TAG]]` (a `sha-<commit>` tag, written by the main pipeline)
- production: `IMAGE_TAG=[[PRODUCTION_IMAGE_TAG]]` (a `sha-<commit>` tag, written by the Promote to Production workflow)

## Procedures

Defined in [`infra/komodo/procedures.toml`](../infra/komodo/procedures.toml):

| Procedure | Purpose |
| --- | --- |
| `deploy-database-{env}` | Deploy the database stack on one environment. |
| `deploy-temporal-{env}` | Deploy the temporal stack. |
| `deploy-observability-{env}` | Deploy the observability stack. |
| `deploy-apps-{env}` | Deploy the apps stack (re-deploy only; promote-production is the normal release path for prod). |
| `deploy-infra-{env}` | Database → temporal → observability. |
| `deploy-all-{env}` | Database → temporal → observability → apps. |
| `restart-apps-{env}` | Restart apps containers without re-pulling. |
| `backup-data-{env}` | One-shot `pg_dump` via the `postgres-backup` service in the database stack. |
| `promote-production` | Manual production apps re-deploy from the UI. The normal release path is the `Promote to Production` GitHub workflow, which deploys through the API. |
| `prune-images` | Scheduled image prune on both servers. |

## RBAC

`resource-sync.toml` has `include_user_groups = true`, so the three UserGroups in [`resources/user-groups.toml`](../infra/komodo/resources/user-groups.toml) are part of the resource sync. Manage individual membership in the Komodo UI after the groups exist.

| Group | Permissions |
| --- | --- |
| `admins` | `Write` on managed Reputo Servers, Stacks, Procedures, Alerters, and ResourceSyncs. |
| `engineers` | `Execute` on staging stacks + every `*-staging` procedure. `Read` on production. |
| `release-managers` | `Execute` on `promote-production`, `deploy-infra-production`, `deploy-observability-production`, `restart-apps-production`, `backup-data-production`. `Read` on the production server and stacks. |

Komodo platform admin status is separate from the `admins` UserGroup. A super admin grants it in the UI.

## Variables and secrets

Secrets live in three different places, read by different processes at different times. Putting a value in the wrong one means it won't be read.

| Location | Read by | Examples |
| --- | --- | --- |
| `infra/komodo/core/core.env` on the Core VM | Komodo Core at startup | `KOMODO_PASSKEY`, `KOMODO_WEBHOOK_SECRET`, `KOMODO_JWT_SECRET`, `KOMODO_DATABASE_PASSWORD`, `KOMODO_GITHUB_OAUTH_*`, `CF_DNS_API_TOKEN` |
| `/etc/komodo/periphery.config.toml` on each Periphery host | Periphery agent at startup | Core public key, `connect_as` name, optional `[secrets]` block for host-scoped values |
| Komodo Variables ([`variables.toml`](../infra/komodo/resources/variables.toml) + UI values) | Komodo Core when materializing Stacks / Procedures / Alerters | Every `STAGING_*` / `PRODUCTION_*` stack value, plus `KOMODO_DISCORD_WEBHOOK_URL` |

The variable shells listed in [`variables.toml`](../infra/komodo/resources/variables.toml) are created when the sync runs with `include_variables = true`. After the first sync creates the shells, fill the values in the Komodo UI under `Settings > Variables`. Then flip `include_variables` back to `false` so later syncs do not flag value diffs as pending.

What does **not** go in Komodo Variables:

- `KOMODO_PASSKEY`, `KOMODO_WEBHOOK_SECRET`, `KOMODO_JWT_SECRET`, `KOMODO_DATABASE_PASSWORD`, OAuth client secrets — Core reads these from `core.env` at startup, before any Variable exists.
- Periphery server addresses — Core auto-fills `Server.address` when the agent registers itself via the outbound flow.
- Per-resource `webhook_secret` overrides — Komodo falls back to the global `KOMODO_WEBHOOK_SECRET` from `core.env`, which is also the value GitHub Actions signs with.

### Shared variables

- `KOMODO_DISCORD_WEBHOOK_URL` — interpolated into [`alerters.toml`](../infra/komodo/resources/alerters.toml).

### Per-environment variables (prefix `STAGING_` or `PRODUCTION_`)

The full list lives in [`variables.toml`](../infra/komodo/resources/variables.toml): domains and origins, Deep ID OIDC settings, AWS and storage, DeepFunding, Grafana, and the Postgres credentials for each database. A few need care:

- `<ENV>_TRAEFIK_AUTH`, `<ENV>_GRAFANA_AUTH` — keep the doubled `$$` htpasswd escaping exactly.
- `<ENV>_API_DATABASE_URL`, `<ENV>_ONCHAIN_DATABASE_URL` — composed from the per-database user, password, and name vars, e.g. `postgresql://<user>:<password>@postgres:5432/<db_name>`.
- `<ENV>_OWNER_EMAIL` — required while `AUTH_MODE=oauth`; the API fails to start if it is missing or out of sync with the owner allowlist row.

Configure the GHCR PAT in Komodo under `Settings > Providers` as a Docker registry account for `ghcr.io`, and attach it to stacks that need authenticated pulls. Do not model the PAT as a stack environment variable. Keep secret values in Komodo or the password manager only; never commit resolved values.

## API access for GitHub Actions

The pipelines authenticate against the Komodo HTTP API with an API key (`X-Api-Key` / `X-Api-Secret` headers). They send three request types: `UpdateVariableValue` (pin the image tag), `DeployStack` (deploy the apps stack), and `GetUpdate` (wait for the deploy to finish).

1. In Komodo, create an API key under `Settings > API Keys`. Use a service user whose permissions cover `Execute` on the apps stacks and writing Variables.
2. Store the pair as `KOMODO_API_KEY` / `KOMODO_API_SECRET` secrets in the GitHub `staging` and `production` environments (or as repository secrets).

The old stack and procedure webhooks are disabled; `KOMODO_WEBHOOK_SECRET` remains a Core bootstrap value in `core.env` but is no longer used by GitHub Actions.

## Add a new server

1. Install Docker Engine and the Compose plugin on the target host.
2. Create or confirm the private/VPN path from Komodo Core to the host.
3. Copy `infra/komodo/periphery/periphery.env.example` to `periphery.env`, fill the passkey and network values, and run `infra/komodo/periphery/install.sh`.
4. Add the server to [`infra/komodo/resources/servers.toml`](../infra/komodo/resources/servers.toml) with an `env:<name>` tag and a `[[<ENV>_PERIPHERY_ADDRESS]]` reference.
5. Add any required Stack resources to the relevant [`infra/komodo/stacks/<name>/stack.toml`](../infra/komodo/stacks/), or create a new stack folder under [`infra/komodo/stacks/`](../infra/komodo/stacks/).
6. Add the matching Komodo variables and secrets.
7. Merge, sync `reputo-main`, and verify the server is reachable.

## Add a new secret

1. Create the secret in Komodo under `Settings > Variables`.
2. Use a clear environment prefix, e.g. `STAGING_<NAME>` and `PRODUCTION_<NAME>`.
3. Reference it in the relevant stack `environment` block as `[[SECRET_NAME]]`.
4. Wire it into the Compose service with an explicit `environment` entry.
5. Merge, sync `reputo-main`, deploy the affected stack. Verify without printing the secret value in logs.

## Backup

Include these host paths in the VM backup policy:

- `/etc/komodo/core/data/postgres`
- `/etc/komodo/core/backups`
- `/etc/komodo/core/data/keys`
- `/etc/komodo/traefik/certs`

Komodo v1.19+ creates a daily "Backup Core Database" procedure on new installs when init resources are enabled. The Core container mounts `/etc/komodo/core/backups` to `/backups` for those logical backups.

Application databases use the `backup-data-{env}` Komodo procedure, which runs the one-shot `postgres-backup` service inside the `reputo-database-{env}` stack. Output is written to the named volume `reputo-database_backups`. Mount or `docker cp` from that volume to copy dumps off-host.

Explicit Komodo Core Postgres dump:

```bash
docker compose \
  -f infra/komodo/core/docker-compose.komodo.yml \
  --env-file infra/komodo/core/core.env \
  --profile backup \
  run --rm postgres-backup
```

## Verification checklist

```bash
docker compose \
  -f infra/komodo/core/docker-compose.komodo.yml \
  --env-file infra/komodo/core/core.env \
  ps

curl -I https://komodo.logid.xyz/
```

Expected:

- `https://komodo.logid.xyz/` shows a valid TLS certificate, and a fresh browser can complete GitHub OAuth login. The first successful login becomes the initial admin.
- Restarting `komodo-core` keeps users, sessions, and resources.
- The webhook secret in `core.env` matches the GitHub staging and production environment secrets.
- Running the ResourceSync creates or updates the three UserGroups.
- An `engineers` member can execute `reputo-apps-staging` but not `promote-production`; a `release-managers` member can execute `promote-production`.
- `reputo-apps-production` has direct stack webhooks disabled.
- Promoting a known `sha-<commit>` deploys `reputo-apps-production`; a missing SHA fails before retagging.
