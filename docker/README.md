# Docker

Layout:

```text
docker/
├── compose/                      # all docker-compose files
│   ├── dev.yml                   # local hot-reload stack
│   ├── apps.yml                  # api, ui, workflows (rotates on deploy)
│   ├── infra.yml                 # traefik, temporal*, postgres (app + temporal + onchain-data)
│   ├── observability.yml         # loki, promtail, prometheus, grafana, ...
│   └── preview.yml               # PullPreview deployment
├── images/
│   └── Dockerfile.dev            # used by compose/dev.yml
├── env/
│   ├── examples/*.env.example    # tracked, source of truth
│   └── *.env                     # runtime, gitignored
└── config/                       # files mounted into containers
    ├── traefik/                  # traefik.yml
    ├── observability/            # grafana/, loki/, prometheus/, promtail/
    └── preview/                  # Caddyfile
```

The application database is the `postgres` service in `infra.yml` (port `5434` on the host). The `temporal-postgresql` and `onchain-data-postgresql` services are separate PG instances with unrelated lifecycles. API ↔ Workflows traffic flows over Temporal activities, so no message-broker service is provisioned.

App `Dockerfile`s for `api`, `ui`, and `workflows` live next to each app at `apps/<app>/Dockerfile` and are built by GitHub Actions, not by these compose files.

## Environment Files

Local dev uses one file: `.env` at the **repo root**, generated from the
tracked `.env.example`. There is no `docker/env/` directory anymore.

```bash
cp .env.example .env
# then fill in placeholders (SECRETs are empty by default)
```

`scripts/env/load.ts` is the one place that reads `.env` and exposes it to
child processes. It's wired into `pnpm dev` (for non-docker) and `pnpm
docker:dev` (for the local hot-reload docker stack). Both fail loudly with a
clear message when `.env` is missing.

For htpasswd-style values such as `TRAEFIK_AUTH` and `GRAFANA_AUTH` (only used
in staging/production via Komodo, not in dev), keep the doubled dollar signs
from upstream examples. Docker Compose env files require `$` to be escaped as
`$$`.

Postgres credentials for the dev stack (`postgres` and
`onchain-data-postgresql` services) are hardcoded inline in
`docker/compose/dev.yml`. They must agree with the credentials encoded in
`DATABASE_URL` and `ONCHAIN_DATABASE_URL` inside `.env` — the dev defaults of
`reputo_app:reputo_app` and `reputo_onchain:reputo_onchain` already match.

## Local Hot Reload

```bash
pnpm docker:dev
```

`pnpm docker:dev` is `scripts/env/load.ts docker compose -f docker/compose/dev.yml up --build`.
You can also invoke compose directly, but you must run the loader first or
export the `.env` vars manually:

```bash
node -e "process.loadEnvFile('.env');" && docker compose -f docker/compose/dev.yml up --build
```

The dev stack builds `docker/images/Dockerfile.dev`, mounts the repo into `/workspace`, and runs watch-mode commands for the API, UI, and workers. Useful local endpoints:

- UI: `http://localhost`
- API via Traefik: `http://localhost/api`
- Traefik dashboard: `http://localhost:8080/dashboard/`
- Temporal UI: `http://localhost:8088`
- Grafana: `http://localhost:3001`

## Staging And Production

Komodo is the deployment authority for staging and production. These Compose
files are still the runtime source of truth, but operators deploy them through
Komodo stacks rather than running host-local update automation.

- `compose/apps.yml` — application services that rotate on every deploy.
- `compose/infra.yml` — stateful services and platform services (`traefik`, Temporal cluster, application `postgres`, `onchain-data-postgresql`, `temporal-postgresql`).
- `compose/observability.yml` — Loki / Promtail / Prometheus / cAdvisor / node-exporter / Grafana

Set `IMAGE_TAG=staging` for staging app deploys and `IMAGE_TAG=production` for
production app deploys.

Komodo injects staging and production runtime configuration through the stack
env files declared under `komodo/resources/stacks/*.toml`. The prod/staging
Compose files (`apps.yml`, `infra.yml`, `observability.yml`) have no
`env_file:` directives — every var flows through compose-level `${VAR}`
interpolation from the Komodo-generated `.komodo-reputo-*.env` file. If you
run these Compose files directly for emergency recovery, provide an env file
with the same keys that Komodo writes.

Main branch builds publish:

- `sha-<commit>`: immutable image tag per affected app
- `staging`: mutable deployment tag for affected apps only

Production promotion resolves the digest behind `sha-<commit>` and retags only the affected apps to:

- `production`
- `prod-<commit>`

Normal deploy flow:

1. Main branch CI builds affected app images and updates the `staging` tag.
2. CI calls the `reputo-apps-staging` Komodo Stack webhook.
3. Production promotion retags a selected `sha-<commit>` digest to
   `production` and calls the `promote-production` Komodo Procedure webhook.
4. Komodo runs `docker compose pull && docker compose up -d` through the
   staging or production Periphery agent.

Manual recovery from a host shell should use the same Compose file set and env
shape that Komodo uses. On a host previously deployed by Komodo, use the
generated env files:

```bash
docker compose \
  -f docker/compose/infra.yml \
  -f docker/compose/observability.yml \
  --env-file .komodo-reputo-infra-production.env up -d

docker compose \
  -f docker/compose/apps.yml \
  --env-file .komodo-reputo-apps-production.env up -d
```

For staging, use the matching `.komodo-reputo-*-staging.env` files.

If the generated files are unavailable, create an equivalent recovery env file
from the variables and secrets listed in `komodo/resources/README.md`, then
pass it explicitly:

```bash
docker compose \
  -f docker/compose/infra.yml \
  -f docker/compose/apps.yml \
  -f docker/compose/observability.yml \
  --env-file recovery.env up -d
```

For operational procedures, see [komodo/README.md](../komodo/README.md).

## Preview

Pull request preview builds publish only `preview-<commit>` tags. Preview compose expects `PREVIEW_IMAGE_TAG` plus the required cloud credentials:

```bash
PREVIEW_IMAGE_TAG=preview-<commit> \
OWNER_EMAIL=preview@example.com \
AWS_ACCESS_KEY_ID=<key> \
AWS_SECRET_ACCESS_KEY=<secret> \
docker compose -f docker/compose/preview.yml up -d
```
