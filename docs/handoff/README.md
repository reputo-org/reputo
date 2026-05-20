# Handoff guide — running Reputo without Komodo

This guide stands up a Reputo staging or production environment on your own host without depending on the original team's Komodo control plane. Everything you need is in this repository.

The contract:

- The Docker Compose files (`docker/compose/infra.yml`, `observability.yml`, `apps.yml`) are the runtime source of truth. The Komodo TOMLs at [`komodo/resources/`](../../komodo/resources/) are wrappers around them.
- The full runtime configuration is declared in a single env file rendered from [`docker/env/examples/prod.env.example`](../../docker/env/examples/prod.env.example). Komodo writes the same shape into `.komodo-reputo-*.env`; this repo writes it into `docker/env/prod.env`.
- The published container images at `ghcr.io/reputo-org/reputo/{api,ui,workflows}` are immutable per commit (`sha-<commit>`) and additionally tagged with rolling channels (`staging`, `production`).

If you keep this contract you do not need Komodo, the staging webhook, or the `promote-production` procedure.

## Prerequisites

- A Linux host with public IPs reachable on `80/tcp` and `443/tcp`.
- Docker Engine 25+ with the Compose plugin.
- A Cloudflare-managed domain (DNS-01 ACME). Other DNS providers work but require editing `docker/compose/infra.yml` (`certificatesresolvers.cloudflare.acme.dnschallenge.provider`).
- A registry account on `ghcr.io` if your fork is private. Public images need no auth.

Sizing reference (single host, all stacks): 4 vCPU, 8 GB RAM, 60 GB SSD is enough for staging-like load. Production with elasticsearch on its own pool needs more.

## 1. DNS

Create A records pointing to your host for at least:

- `app.example.com` → UI
- `api.example.com` → API
- `traefik.example.com` → Traefik dashboard (basic-auth protected)
- `grafana.example.com` → Grafana
- `temporal.example.com` → Temporal UI (basic-auth protected)

## 2. Render the env file

```bash
git clone https://github.com/reputo-org/reputo.git
cd reputo

cp docker/env/examples/prod.env.example docker/env/prod.env
chmod 600 docker/env/prod.env

# Edit prod.env and fill every `replace-with-...` value.
# Use the credentials inventory at docs/credentials.md as a checklist.
```

Generate strong secrets:

```bash
openssl rand -hex 32         # AUTH_TOKEN_ENCRYPTION_KEY
openssl rand -base64 24      # generic passwords
htpasswd -nbB admin '<password>'   # TRAEFIK_AUTH / GRAFANA_AUTH — remember to double every $ to $$
```

## 3. Create the Docker network

The Compose files attach to an external network called `production`. Create it once:

```bash
docker network create production
```

## 4. Validate, pull, deploy

From the repo root:

```bash
make selfhost-config    # prints the merged compose; fails loudly on missing vars
make selfhost-pull
make selfhost-up
make selfhost-ps
```

`selfhost-up` will prompt before applying. The same target is idempotent — re-run it after editing `docker/env/prod.env` or pulling a new image tag.

## 5. Verify

- `https://app.example.com/` → UI loads and OAuth login works against your DeepID tenant.
- `https://api.example.com/api/health` → `200 OK`.
- `https://temporal.example.com/` → behind basic-auth (`TRAEFIK_AUTH`); shows the `default` namespace.
- `https://grafana.example.com/` → behind basic-auth (`GRAFANA_AUTH`); the Reputo dashboards are auto-provisioned.

Watch the workers come up:

```bash
make selfhost-logs SVC=orchestrator-worker
make selfhost-logs SVC=onchain-data-worker
make selfhost-logs SVC=typescript-worker
```

## 6. Upgrade

Bump `IMAGE_TAG` (or specific service tags) in `docker/env/prod.env`, then:

```bash
make selfhost-pull
make selfhost-up
```

Compose performs a rolling restart of containers whose image digest changed. Volumes are preserved.

For pinned deploys, point `IMAGE_TAG` at a specific `sha-<commit>` instead of the rolling `production` tag.

## 7. Rollback

Identify the previous good `sha-<commit>` (or `prod-<commit>`), set it in `prod.env`, and re-run `make selfhost-pull && make selfhost-up`. Mongo and Postgres data persist across image changes; if a migration is non-reversible you'll need an explicit restore.

## 8. Backup

Volumes you must back up:

- `mongodb_data` — application database
- `temporal_postgresql_data` — Temporal history
- `onchain_data_postgresql_data` — onchain sync cache (rebuildable, but slow)
- `grafana_data` — dashboard state and user accounts
- `prometheus_data` and `loki_data` — observability history (optional)

A simple approach: `docker run --rm -v <volume>:/data -v $(pwd):/backup alpine tar czf /backup/<vol>.tar.gz -C /data .` against each volume on a cron.

## 9. CI/CD without Komodo

The image build (`.github/workflows/_build-and-push.yml`) does not depend on Komodo. It builds and pushes `sha-<commit>` and the rolling channel tag to GHCR. To deploy without the Komodo webhook, replace the webhook step in `.github/workflows/main.yml` and `promote-production.yml` with an SSH-and-compose-up step against your host. For example:

```yaml
- name: Deploy to self-host
  uses: appleboy/ssh-action@v1
  with:
    host: ${{ secrets.DEPLOY_HOST }}
    username: ${{ secrets.DEPLOY_USER }}
    key:      ${{ secrets.DEPLOY_SSH_KEY }}
    script: |
      cd /opt/reputo
      git fetch origin && git reset --hard origin/main
      make selfhost-pull
      make selfhost-up
```

The Komodo TOMLs in `komodo/resources/` can stay or be deleted at your discretion — they no longer participate in this flow.

## What the original team kept (and why it's not yours)

For reference, the original team's deploy plane is in [`komodo/`](../../komodo/). Komodo is a Rust-based deploy controller that:

- Stores runtime variables in its own UI rather than in `prod.env`.
- Receives GitHub webhook events and runs `docker compose pull && up -d` on a remote Periphery agent.
- Provides RBAC and an audit log.

You can adopt Komodo if you want those features, but nothing in this repo requires it.
