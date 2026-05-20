# Docker

Layout:

```text
docker/
├── compose/                      # docker-compose files
│   ├── dev.yml                   # local hot-reload stack (includes MinIO)
│   ├── apps.yml                  # api, ui, workflows (rotates on deploy)
│   ├── infra.yml                 # mongo, traefik, temporal*, postgres
│   ├── observability.yml         # loki, promtail, prometheus, grafana, ...
│   └── preview.yml               # PullPreview deployment
├── images/
│   └── Dockerfile.dev            # used by compose/dev.yml
├── env/
│   ├── examples/                 # tracked source of truth
│   │   ├── *.env.example         # per-service files for the dev stack
│   │   └── prod.env.example      # bundled file for the self-host path
│   └── *.env                     # runtime, gitignored
└── config/                       # files mounted into containers
    ├── mongo/                    # init.js, healthcheck.js
    ├── traefik/                  # traefik.yml
    ├── observability/            # grafana/, loki/, prometheus/, promtail/
    └── preview/                  # Caddyfile
```

App `Dockerfile`s for `api`, `ui`, and `workflows` live next to each app at `apps/<app>/Dockerfile` and are built by GitHub Actions, not by these compose files.

## Environment Files

Tracked examples under `docker/env/examples/` are the source of truth. Runtime files in `docker/env/*.env` are local-only and gitignored. Use `make bootstrap` from the repo root to copy them all and generate secrets in one step.

For the dev stack each service has its own env file (`api.env`, `workflows.env`, `mongodb.env`, …). For the Komodo-free self-host path, a single `docker/env/prod.env` is used for the merged infra + observability + apps stack (see [docs/handoff/README.md](../docs/handoff/README.md)).

For htpasswd-style values such as `TRAEFIK_AUTH` and `GRAFANA_AUTH`, keep the doubled dollar signs from the examples. Docker Compose env files require `$` to be escaped as `$$`.

## MongoDB Keyfile

MongoDB runs as a single-node replica set and requires a keyfile. The Compose
files generate `/etc/mongo-keyfile/keyfile.txt` on first startup and persist it
in the `mongodb_keyfile` Docker volume. Do not commit or manually provision
`docker/config/mongo/keyfile.txt`; any local copy is ignored and unused by the
current Compose files.

## Local Hot Reload

```bash
make up               # docker compose -f docker/compose/dev.yml up --build -d
make logs SVC=api     # docker compose -f docker/compose/dev.yml logs -f api
make down             # stop, preserve volumes
make nuke             # stop and delete volumes (irreversible)
```

The dev stack builds `docker/images/Dockerfile.dev`, mounts the repo into `/workspace`, runs watch-mode commands for the API, UI, and workers, and starts a local MinIO for S3 access. Useful local endpoints:

- UI: `http://localhost`
- API via Traefik: `http://localhost/api`
- Traefik dashboard: `http://localhost:8080/dashboard/`
- Temporal UI: `http://localhost:8088`
- Grafana: `http://localhost:3001`
- MinIO S3 API: `http://localhost:9000`
- MinIO console: `http://minio.localhost` (also `http://localhost:9001`)

## Staging And Production

Komodo is the deployment authority for staging and production. These Compose
files are still the runtime source of truth, but operators deploy them through
Komodo stacks rather than running host-local update automation.

- `compose/apps.yml` — application services that rotate on every deploy.
- `compose/infra.yml` — stateful services and platform services (`mongo`, `traefik`, Temporal cluster, Postgres).
- `compose/observability.yml` — Loki / Promtail / Prometheus / cAdvisor / node-exporter / Grafana

Set `IMAGE_TAG=staging` for staging app deploys and `IMAGE_TAG=production` for
production app deploys.

Komodo injects staging and production runtime configuration through the stack
env files declared under `komodo/resources/stacks/*.toml`. The prod/staging
Compose files do not load per-service `docker/env/*.env` files because Komodo
clones this repo and those runtime files are gitignored. If you run these
Compose files directly for emergency recovery, provide an env file with the
same keys that Komodo writes to the generated `.komodo-reputo-*.env` files.

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
