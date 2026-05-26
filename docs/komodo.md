# Komodo operations

[Komodo](https://komo.do) is the deployment control plane for Reputo staging and production. Core runs on a dedicated host at <https://komodo.logid.xyz>. Staging and production hosts run Periphery agents that execute the declared Compose stacks.

```text
GitHub Actions -> GHCR image tags -> Komodo webhooks -> Periphery -> Docker Compose
```

This page covers operator topics. For day-to-day deploys, see [Deployment](deployment.md). For the directory layout and stack model, see [infra/komodo/README.md](../infra/komodo/README.md).

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

Reputo runs as four Komodo Stacks per environment. Each Stack is a separate Docker Compose project on the host and joins the shared external bridge network `reputo`. See [infra/komodo/README.md](../infra/komodo/README.md) for the split rationale.

- `reputo-database-{env}` — application Postgres + onchain-data Postgres + on-demand `postgres-backup`. Folder: [infra/komodo/stacks/database/](../infra/komodo/stacks/database/).
- `reputo-temporal-{env}` — Temporal server + UI + Postgres + Elasticsearch. Folder: [infra/komodo/stacks/temporal/](../infra/komodo/stacks/temporal/).
- `reputo-observability-{env}` — Loki/Promtail/Prometheus/cAdvisor/node-exporter/Grafana. Folder: [infra/komodo/stacks/observability/](../infra/komodo/stacks/observability/).
- `reputo-apps-{env}` — Traefik + UI + API + workflow workers. Folder: [infra/komodo/stacks/apps/](../infra/komodo/stacks/apps/).

Posture:

- The staging apps stack is the source of truth for staging deploys: `poll_for_updates = false`, `webhook_enabled = true`, `webhook_force_deploy = true`, `deploy = false`. GitHub Actions calls the staging Stack webhook after a successful image build.
- The production apps stack has direct stack webhooks disabled. GitHub Actions performs the digest-based production retag, then calls the `promote-production` Procedure webhook.
- Database, temporal, and observability stacks have webhooks and polling disabled. They are deployed manually through the `deploy-*` procedures.

Each stack writes a Komodo-managed env file at deploy time from the TOML `environment` block:

- `.komodo-reputo-database-{env}.env`
- `.komodo-reputo-temporal-{env}.env`
- `.komodo-reputo-observability-{env}.env`
- `.komodo-reputo-apps-{env}.env`

These files are generated on the target host and passed to Docker Compose with `--env-file`. The checked-in TOML references Komodo variables and secrets by `[[NAME]]` only. Resolved values must never be committed.

The apps stacks pin the channel tags:

- staging: `IMAGE_TAG=staging`
- production: `IMAGE_TAG=production`

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
| `promote-production` | Production app deploy after the GitHub Actions digest retag. Webhook-triggered. |
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

The variable shells listed in [`variables.toml`](../infra/komodo/resources/variables.toml) are created when the sync runs with `include_variables = true`. After the first sync creates the shells, fill the values in the Komodo UI under `Settings > Variables`. Then flip `include_variables` back to `false` so later syncs do not flag value diffs as pending.

### Shared variables

- `KOMODO_PASSKEY`
- `KOMODO_WEBHOOK_SECRET`
- `KOMODO_DISCORD_WEBHOOK_URL`
- `STAGING_PERIPHERY_ADDRESS`
- `PRODUCTION_PERIPHERY_ADDRESS`

### Per-environment variables (prefix `STAGING_` or `PRODUCTION_`)

Non-secret:

- `<ENV>_TRAEFIK_DOMAIN`, `<ENV>_UI_DOMAIN`, `<ENV>_API_DOMAIN`, `<ENV>_TEMPORAL_UI_DOMAIN`, `<ENV>_GRAFANA_DOMAIN`
- `<ENV>_ALLOWED_ORIGINS`, `<ENV>_APP_PUBLIC_URL`, `<ENV>_AUTH_COOKIE_DOMAIN`
- `<ENV>_OWNER_EMAIL` — required while `AUTH_MODE=oauth`. The API fails to start if missing or out of sync with the active owner allowlist row.
- `<ENV>_GRAFANA_ADMIN_USER`
- `<ENV>_DEEP_ID_ISSUER_URL`, `<ENV>_DEEP_ID_CLIENT_ID`, `<ENV>_DEEP_ID_AUTH_REDIRECT_URI`, `<ENV>_DEEP_ID_AUTH_SCOPES`, `<ENV>_DEEP_ID_CONSENT_REDIRECT_URI`, `<ENV>_DEEP_ID_CONSENT_GRANT_TTL_SECONDS`, `<ENV>_DEEP_ID_VOTING_PORTAL_SCOPES`
- `<ENV>_VOTING_PORTAL_RETURN_URL`
- `<ENV>_AWS_REGION`, `<ENV>_STORAGE_BUCKET`
- `<ENV>_DEEPFUNDING_API_BASE_URL`
- `<ENV>_API_POSTGRES_DB_NAME`, `<ENV>_ONCHAIN_DATA_POSTGRES_DB_NAME`

Secrets:

- `<ENV>_TRAEFIK_AUTH`, `<ENV>_GRAFANA_AUTH` — keep doubled `$$` escaping exactly as the upstream htpasswd examples do.
- `<ENV>_CF_DNS_API_TOKEN`
- `<ENV>_GRAFANA_ADMIN_PASSWORD`
- `<ENV>_DEEP_ID_CLIENT_SECRET`
- `<ENV>_AUTH_TOKEN_ENCRYPTION_KEY`
- `<ENV>_DEEPFUNDING_API_KEY`
- `<ENV>_ALCHEMY_API_KEY`
- `<ENV>_BLOCKFROST_API_KEY`
- `<ENV>_TEMPORAL_POSTGRES_USER`, `<ENV>_TEMPORAL_POSTGRES_PASSWORD`
- `<ENV>_ONCHAIN_DATA_POSTGRES_USER`, `<ENV>_ONCHAIN_DATA_POSTGRES_PASSWORD`
- `<ENV>_ONCHAIN_DATABASE_URL` — composed from the three onchain DB vars, e.g. `postgresql://<user>:<password>@onchain-data-postgresql:5432/<db_name>`.
- `<ENV>_API_POSTGRES_USER`, `<ENV>_API_POSTGRES_PASSWORD`
- `<ENV>_API_DATABASE_URL` — composed from the three API DB vars, e.g. `postgresql://<user>:<password>@postgres:5432/<db_name>`.

Configure the GHCR PAT in Komodo under `Settings > Providers` as a Docker registry account for `ghcr.io`. Attach that registry account to the stacks if image pulls need authentication. Do not model the PAT as a stack environment variable.

### Recommended tags

- `env:staging` or `env:production`
- `scope:cloudflare`, `scope:traefik`, `scope:grafana`, `scope:postgres`, `scope:aws`, `scope:deep-id`, `scope:deepfunding`, `scope:onchain`, `scope:ghcr`

### Cutover order

1. With `include_variables = true`, run the sync once to create variable and secret shells. Fill the values in the UI, then flip `include_variables` back to `false`.
2. Sync resources and UserGroups.
3. Add users to UserGroups in the UI.
4. Deploy through Komodo and confirm all services start.
5. Compare selected container env values before and after migration. Do not print secrets to logs.
6. Manually delete or disable any legacy alerter. ResourceSync has `delete = false`.

Keep secret values in Komodo or the password manager only. Never commit resolved values.

## Webhooks

Staging Stack webhook:

```text
https://komodo.logid.xyz/listener/github/stack/reputo-apps-staging/deploy
```

Configure the GitHub `staging` environment secret `KOMODO_WEBHOOK_SECRET` with the same value as Komodo Core.

Production promotion Procedure webhook:

```text
https://komodo.logid.xyz/listener/github/procedure/promote-production/__ANY__
```

Configure the GitHub `production` environment secret `KOMODO_WEBHOOK_SECRET` with the same value as Komodo Core.

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

- `https://komodo.logid.xyz/` shows a valid Cloudflare/Let's Encrypt TLS certificate.
- A fresh browser can complete GitHub OAuth login.
- The first successful login becomes the initial admin.
- Restarting `komodo-core` keeps users, sessions, and resources.
- Power-cycling the VM brings Traefik, Postgres, FerretDB, Core, and Periphery back up with `restart: unless-stopped`.
- The webhook secret in `core.env` matches the GitHub staging and production environment secrets.
- Running the ResourceSync creates or updates the three UserGroups.
- An `engineers` member can execute `reputo-apps-staging` but cannot execute `promote-production`.
- A `release-managers` member can execute `promote-production`.
- `reputo-apps-production` has direct stack webhooks disabled.
- A Discord test alert from Komodo succeeds.
- Promoting a known `sha-<commit>` deploys `reputo-apps-production`.
- Promoting a missing SHA fails before retagging or calling Komodo.
- The Komodo audit log shows the production Procedure run and the promoted commit SHA from the webhook payload.
