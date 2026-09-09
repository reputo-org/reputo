# Komodo operations

[Komodo](https://komo.do) is the deployment control plane for staging and production. Core runs at <https://komodo.logid.xyz>. The staging and production hosts run Periphery agents that execute the Compose stacks. Day-to-day deploys are in [Deployment](deployment.md).

```text
GitHub Actions -> GHCR image tags -> Komodo API (pin tag + deploy) -> Periphery -> Docker Compose
```

## Files

| Path | Purpose |
| --- | --- |
| [`infra/komodo/core/docker-compose.komodo.yml`](../infra/komodo/core/docker-compose.komodo.yml) | Runs Traefik, Komodo Core, FerretDB, Postgres, and a self-Periphery agent. |
| [`infra/komodo/core/core.env.example`](../infra/komodo/core/core.env.example) | Template for `core.env` on the Core host. |
| [`infra/komodo/periphery/install.sh`](../infra/komodo/periphery/install.sh) | Installs the Periphery agent on a host. |
| [`infra/komodo/resource-sync.toml`](../infra/komodo/resource-sync.toml) | The `reputo-main` ResourceSync. |
| [`infra/komodo/procedures.toml`](../infra/komodo/procedures.toml) | Every Procedure (`deploy-*`, `restart-*`, `backup-*`). |
| [`infra/komodo/resources/`](../infra/komodo/resources/) | Servers, variables, user groups, alerters. |
| [`infra/komodo/stacks/`](../infra/komodo/stacks/) | One folder per stack: `stack.toml`, `compose.yml`, service config. |

## Install Core

The Core VM needs 1 vCPU, 2 GB RAM, Docker with the Compose plugin, ports 80 and 443 open, and the DNS record `komodo.logid.xyz`.

```bash
mkdir -p /opt/reputo && cd /opt/reputo
# Get this repository onto the host, then:
cp infra/komodo/core/core.env.example infra/komodo/core/core.env
chmod 600 infra/komodo/core/core.env
# Replace every CHANGE_ME value in core.env from the password manager.

sudo mkdir -p /etc/komodo/traefik/certs /etc/komodo/core/data/{postgres,ferretdb-state,keys,syncs,repo-cache} /etc/komodo/core/backups
sudo chown -R 1000:1000 /etc/komodo/core/data/ferretdb-state   # FerretDB runs as UID 1000
sudo touch /etc/komodo/traefik/certs/cloudflare-acme.json
sudo chmod 600 /etc/komodo/traefik/certs/cloudflare-acme.json

docker compose -f infra/komodo/core/docker-compose.komodo.yml --env-file infra/komodo/core/core.env up -d
```

The first successful GitHub OAuth login becomes the initial admin.

## Install Periphery (per host)

```bash
cp infra/komodo/periphery/periphery.env.example infra/komodo/periphery/periphery.env
chmod 600 infra/komodo/periphery/periphery.env
# Set KOMODO_PASSKEY (same as Core), PERIPHERY_ALLOWED_IPS (Core IP or VPN CIDR),
# and PERIPHERY_PUBLISH_IP (private host IP reachable from Core).
infra/komodo/periphery/install.sh --env-file infra/komodo/periphery/periphery.env
```

Register the host in the Komodo UI with the name `staging` or `production`, the address `http://<PERIPHERY_PUBLISH_IP>:8120`, and the shared passkey. Block port 8120 from the public internet with the host or cloud firewall. `PERIPHERY_ALLOWED_IPS` is a second layer, not the exposure control.

## Resource sync

Core syncs the `infra/komodo` tree from `main` through the `reputo-main` ResourceSync. `managed = false` and `delete = false` keep sync runs reviewable and non-destructive.

After merging a resource change: open `Resources > Resource Syncs > reputo-main`, review the diff, execute the sync.

## Stacks

Each environment runs four stacks. Each is its own Compose project on the shared `reputo` network. Datastores get their own stacks so that a restart of one does not bounce the others. The apps stack redeploys on every merge.

| Stack | Services | Deployed by |
| --- | --- | --- |
| `reputo-database-{env}` | app Postgres, onchain-data Postgres, on-demand `postgres-backup` | `deploy-database-{env}` procedure |
| `reputo-temporal-{env}` | Temporal server, UI, Postgres | `deploy-temporal-{env}` procedure |
| `reputo-observability-{env}` | Loki, Promtail, Prometheus, cAdvisor, node-exporter, Grafana | `deploy-observability-{env}` procedure |
| `reputo-apps-{env}` | Traefik, UI, API, the four workers | The GitHub Actions pipeline through the Komodo API |

Stack webhooks and polling are disabled everywhere. At deploy time each stack writes a Komodo-managed env file from its `stack.toml` `environment` block. The checked-in TOML references values as `[[NAME]]` only. The apps stacks pin `IMAGE_TAG=[[STAGING_IMAGE_TAG]]` or `[[PRODUCTION_IMAGE_TAG]]`.

## Procedures

| Procedure | Purpose |
| --- | --- |
| `deploy-database-{env}`, `deploy-temporal-{env}`, `deploy-observability-{env}` | Deploy one infrastructure stack. |
| `deploy-apps-{env}` | Re-deploy the apps stack. The normal release path is the pipeline. |
| `deploy-infra-{env}` | Database, then Temporal, then observability. |
| `deploy-all-{env}` | Everything, apps last. |
| `restart-apps-{env}` | Restart the apps containers without a pull. |
| `backup-data-{env}` | One-shot `pg_dump` through the `postgres-backup` service. |
| `promote-production` | Manual production re-deploy from the UI. Prefer the `Promote to Production` workflow. |
| `prune-images` | Scheduled image prune on both servers. |

## RBAC

The sync includes the three user groups in [`user-groups.toml`](../infra/komodo/resources/user-groups.toml). Add people to groups in the UI.

| Group | Permissions |
| --- | --- |
| `admins` | `Write` on managed servers, stacks, procedures, alerters, and syncs. |
| `engineers` | `Execute` on staging stacks and `*-staging` procedures. `Read` on production. |
| `release-managers` | `Execute` on `promote-production` and the production infra, observability, restart, and backup procedures. `Read` on production. |

Komodo platform admin is separate from the `admins` group. A super admin grants it in the UI.

## Variables and secrets

| Location | Read by | Examples |
| --- | --- | --- |
| `core.env` on the Core VM | Komodo Core at startup | `KOMODO_PASSKEY`, `KOMODO_WEBHOOK_SECRET`, `KOMODO_JWT_SECRET`, `KOMODO_DATABASE_PASSWORD`, `KOMODO_GITHUB_OAUTH_*`, `CF_DNS_API_TOKEN` |
| `/etc/komodo/periphery.config.toml` on each host | The Periphery agent | Core public key, `connect_as` name, host-scoped secrets |
| Komodo variables ([`variables.toml`](../infra/komodo/resources/variables.toml) plus UI values) | Core when it materializes stacks and procedures | Every `STAGING_*` and `PRODUCTION_*` value, `KOMODO_DISCORD_WEBHOOK_URL` |

The variable shells are created when the sync runs with `include_variables = true`. Fill the values under `Settings > Variables`, then set `include_variables` back to `false`.

Notes on a few values:

- `<ENV>_TRAEFIK_AUTH` and `<ENV>_GRAFANA_AUTH` keep the doubled `$$` htpasswd escaping.
- `<ENV>_API_DATABASE_URL` and `<ENV>_ONCHAIN_DATABASE_URL` are composed as `postgresql://<user>:<password>@postgres:5432/<db>`.
- `<ENV>_OWNER_EMAIL` is required with `AUTH_MODE=oauth`. The API fails to start without it.
- The GHCR pull token is a Docker registry account under `Settings > Providers`, not a variable.

Never commit resolved values.

## API access for GitHub Actions

The pipeline calls `UpdateVariableValue`, `DeployStack`, and `GetUpdate` with an API key. Create the key under `Settings > API Keys` for a service user with `Execute` on the apps stacks and write access to variables. Store it as `KOMODO_API_KEY` and `KOMODO_API_SECRET` in the GitHub `staging` and `production` environments.

## Add a server

1. Install Docker on the host and confirm the private path from Core.
2. Install Periphery as above.
3. Add the server to [`servers.toml`](../infra/komodo/resources/servers.toml) with an `env:<name>` tag and a `[[<ENV>_PERIPHERY_ADDRESS]]` reference.
4. Add the stacks under [`infra/komodo/stacks/`](../infra/komodo/stacks/) and the matching variables.
5. Merge, sync `reputo-main`, verify the server is reachable.

## Add a secret

1. Create it under `Settings > Variables` as `STAGING_<NAME>` and `PRODUCTION_<NAME>`.
2. Reference it as `[[NAME]]` in the stack's `environment` block and wire it into the Compose service.
3. Merge, sync, deploy the stack. Verify without printing the value.

## Backup

Back up these Core VM paths: `/etc/komodo/core/data/postgres`, `/etc/komodo/core/backups`, `/etc/komodo/core/data/keys`, `/etc/komodo/traefik/certs`. Komodo creates a daily "Backup Core Database" procedure on new installs.

Application databases use the `backup-data-{env}` procedure. Dumps land in the `reputo-database_backups` volume. Copy them off-host with `docker cp`.

## Verification checklist

- <https://komodo.logid.xyz/> serves a valid certificate and GitHub OAuth login works.
- Restarting `komodo-core` keeps users, sessions, and resources.
- The ResourceSync creates or updates the three user groups.
- An `engineers` member can deploy staging but not run `promote-production`. A `release-managers` member can.
- Promoting a known `sha-<commit>` deploys production. A missing SHA fails before retagging.
