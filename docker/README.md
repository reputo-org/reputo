# Docker

Layout:

```text
docker/
├── compose/
│   ├── compose.yml           # unified staging / production / preview
│   └── compose.dev.yml       # local hot-reload (separate, see below)
├── images/
│   └── Dockerfile.dev        # used by compose.dev.yml
└── config/                   # mounted into containers
    ├── traefik/
    │   ├── traefik.yml       # prod/staging — Cloudflare ACME, HTTPS
    │   └── preview.yml       # preview — HTTP only, no ACME
    └── observability/        # grafana/, loki/, prometheus/, promtail/
```

`compose.yml` is the single source of truth for every non-local environment.
Service selection is by profile (`COMPOSE_PROFILES`):

| Profile         | Services                                                                                 |
|-----------------|------------------------------------------------------------------------------------------|
| `apps`          | `api`, `ui`, `orchestrator-worker`, `onchain-data-worker`, `typescript-worker`           |
| `infra`         | `traefik`, `temporal`, `temporal-ui`, `temporal-elasticsearch`, `temporal-postgresql`, `postgres`, `onchain-data-postgresql` |
| `observability` | `loki`, `promtail`, `prometheus`, `cadvisor`, `node-exporter`, `grafana`                 |
| `storage`       | `minio` + `minio-init` (S3-compatible object storage for dev/preview)                    |

Komodo's `reputo-apps-*` stacks run with `COMPOSE_PROFILES=apps`; the
`reputo-infra-*` stacks run with `COMPOSE_PROFILES=infra,observability`.
Preview (PullPreview) runs with `COMPOSE_PROFILES=apps,infra,storage`.

Prod/staging do **not** activate `storage` — they use real AWS S3 via the SDK's
default credential chain (IAM role). MinIO exists only in dev (compose.dev.yml,
always on) and preview (compose.yml `storage` profile, opted in by the
pull-preview workflow).

Apps and infra Komodo stacks deploy with **different** `COMPOSE_PROJECT_NAME`s
(the stack name) so they own disjoint slices of the file. They share the
`reputo`/`production` Docker network (set via `COMPOSE_NETWORK_NAME`) so
cross-stack DNS keeps working.

App `Dockerfile`s for `api`, `ui`, and `workflows` live next to each app at
`apps/<app>/Dockerfile` and are built by GitHub Actions, not by these compose
files.

## Best-practice features in compose.yml

- **No `version:`** key — modern Compose ignores it.
- **YAML anchors** for service defaults (`*service-defaults`), resource tiers
  (`*resources-{xs,s,m,l,xl}`), logging, healthchecks, and the universal
  secret-reading command wrapper — duplication is collapsed to the minimum.
- **Healthchecks in compose** (not in Dockerfiles): TCP-port checks for
  `api`/`ui`, `pg_isready` for Postgres, native CLI for Traefik/Temporal,
  HTTP probe for Grafana/Loki.
- **Restart policy**: `unless-stopped` everywhere (via `*service-defaults`).
- **Resource limits**: every container has a `deploy.resources` block sized
  via the five named tiers. Total memory limit sums to ~3.7 GB so the full
  apps + infra + observability set fits a 4 GB host with ~300 MB headroom.
- **Logging**: `json-file` driver with `max-size: 10m, max-file: 5` to bound
  disk usage.
- **Init**: `init: true` for proper PID 1 signal handling.
- **Hardening**: `security_opt: [no-new-privileges:true]`.
- **Pinned image tags** everywhere; `pull_policy: always` on app images so
  `docker compose up` always fetches the freshest `IMAGE_TAG`.
- **Secrets via Compose env source**: `AWS_*`, `ALCHEMY_API_KEY`, and
  `DEEPFUNDING_API_KEY` are exposed to api/workers as `/run/secrets/*` files
  (never in the service `environment:` block, so `docker inspect` won't
  reveal them). A universal shell wrapper re-exports them into process env at
  startup, so the app code can keep reading them via `process.env.*`.

## Environment files

Local dev uses one file: `.env` at the **repo root**, generated from the
tracked `.env.example`. There is no `docker/env/` directory.

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
`docker/compose/compose.dev.yml`. They must agree with the credentials encoded
in `DATABASE_URL` and `ONCHAIN_DATABASE_URL` inside `.env` — the dev defaults
of `reputo_app:reputo_app` and `reputo_onchain:reputo_onchain` already match.

## Local hot reload

```bash
pnpm docker:up    # build images + start the stack detached
pnpm docker:down  # stop everything
```

Both wrap `scripts/env/load.ts docker compose -f docker/compose/compose.dev.yml
…`. If you invoke compose directly, pass `--env-file .env` so Compose picks
up your root env vars at interpolation time (Compose otherwise looks for
`.env` next to the compose file, not at the repo root):

```bash
docker compose --env-file .env -f docker/compose/compose.dev.yml up -d --build
```

The dev stack (13 services) builds `docker/images/Dockerfile.dev`, mounts the
repo into `/workspace`, and runs watch-mode commands for the API, UI, and
workers. It is intentionally trimmed: no Traefik (apps expose their host
ports directly, same as `pnpm dev`) and no observability stack (Loki /
Promtail / Prometheus / cAdvisor / node-exporter / Grafana). The full
observability stack lives only in `compose.yml` for staging/prod.

### Database migrations (local + Docker)

The Docker entrypoint for the prod `api` image runs TypeORM migrations before
starting Nest. The local `pnpm dev` flow does **not** — apply migrations
manually whenever you bring up a fresh `postgres` volume or pull new migration
files:

```bash
pnpm db:migrate            # apply pending migrations
pnpm db:migrate:show       # ✓ applied / [ ] pending
pnpm db:migrate:revert     # roll back the most recent
pnpm db:migrate:generate src/persistence/migrations/<Name>
pnpm db:reset              # DROP public schema in the dev postgres container, then re-migrate
```

The first four scripts go through `scripts/env/load.ts`, so they pick up the
root `.env` exactly like `pnpm dev` does. Running `pnpm --filter @reputo/api
typeorm:run` directly skips the loader and the Zod schema will reject the
empty env.

`db:reset` is for when the dev DB has drifted (typically after pulling new
migrations that conflict with an old schema in your `postgres_data` volume,
or after a partial migration run failed mid-way). It's destructive — it
DROPs the `public` schema in the running `postgres` container and re-runs
migrations from scratch. Dev-only; never run it against staging/production.

Useful local endpoints:

- UI: `http://localhost:4000` (Next.js dev server; `/api/*` is rewritten in-app to the api container)
- API direct: `http://localhost:3000`
- Temporal UI: `http://localhost:8088`
- MinIO console: `http://localhost:9001` (login `minio` / `minio12345`)
- Postgres (app DB): `psql postgresql://reputo_app:reputo_app@localhost:5434/reputo_app`
- Onchain Postgres: `psql postgresql://reputo_onchain:reputo_onchain@localhost:5433/reputo_onchain`

## Staging and production

Komodo is the deployment authority for staging and production. `compose.yml`
is the runtime source of truth, but operators deploy it through Komodo stacks
rather than running host-local update automation.

| Stack                       | `COMPOSE_PROFILES`         | Services managed                                  |
|-----------------------------|----------------------------|---------------------------------------------------|
| `reputo-apps-staging`       | `apps`                     | api, ui, workers (rotates on every deploy)        |
| `reputo-apps-production`    | `apps`                     | same, prod tag                                    |
| `reputo-infra-staging`      | `infra,observability`      | traefik, temporal cluster, postgres, observability |
| `reputo-infra-production`   | `infra,observability`      | same, prod                                         |

Set `IMAGE_TAG=staging` for staging app deploys and `IMAGE_TAG=production` for
production app deploys.

Komodo injects staging and production runtime configuration through the stack
env files declared under `komodo/resources/stacks/*.toml`. The compose file
has no `env_file:` directives — every var flows through compose-level
`${VAR}` interpolation from the Komodo-generated `.komodo-reputo-*.env` file.
If you run it directly for emergency recovery, provide an env file with the
same keys.

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
   staging or production Periphery agent, scoped by `COMPOSE_PROFILES`.

Manual recovery from a host shell should use the same compose file and env
shape that Komodo uses. On a host previously deployed by Komodo, use the
generated env files:

```bash
COMPOSE_PROFILES=infra,observability \
COMPOSE_NETWORK_NAME=production \
docker compose -f docker/compose/compose.yml \
  --env-file .komodo-reputo-infra-production.env up -d

COMPOSE_PROFILES=apps \
COMPOSE_NETWORK_NAME=production \
docker compose -f docker/compose/compose.yml \
  --env-file .komodo-reputo-apps-production.env up -d
```

For staging, use the matching `.komodo-reputo-*-staging.env` files.

If the generated files are unavailable, create an equivalent recovery env file
from the variables and secrets listed in `komodo/resources/README.md`, then
pass it explicitly.

For operational procedures, see [komodo/README.md](../komodo/README.md).

## Object storage

| Env             | Endpoint                  | Credentials                        | Bucket lifecycle              |
|-----------------|---------------------------|------------------------------------|-------------------------------|
| `pnpm docker:dev` | `http://minio:9000`     | hardcoded `minio` / `minio12345`   | `minio-init` creates `STORAGE_BUCKET` at startup |
| Preview         | `http://minio:9000`       | `minio` / `minio12345preview`      | `minio-init` creates `reputo-preview` at startup |
| Staging / prod  | AWS S3 (real)             | SDK default credential chain (IAM) | bucket pre-existing in AWS    |

The `@reputo/storage` `createS3Client` honors `endpoint` + `forcePathStyle`,
mapped from `STORAGE_ENDPOINT` / `STORAGE_FORCE_PATH_STYLE`. When the endpoint
is unset, the client talks to real AWS.

**Credentials are never read by the app's Zod schema.** The AWS SDK pulls them
from the container env (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`) via its
default credential provider chain, or — when those are unset — falls through
to IAM/instance profiles.

To avoid leaking the PullPreview action's runner AWS creds (used to provision
Lightsail) into the application container, the compose interpolation reads
**`APP_AWS_ACCESS_KEY_ID`** / **`APP_AWS_SECRET_ACCESS_KEY`** from the compose
env and writes them onto the container's `AWS_ACCESS_KEY_ID` /
`AWS_SECRET_ACCESS_KEY`. Prod/staging leave both unset; the container env
ends up with empty strings, which the SDK treats as "no env creds" and skips
to the IAM credential provider.

## Preview

Pull request preview builds publish only `preview-<commit>` tags. The preview
deployment uses the same `docker/compose/compose.yml` with
`COMPOSE_PROFILES=apps,infra,storage` and a handful of preview-specific env
vars set by `.github/workflows/pull-preview.yml`:

- `TRAEFIK_CONFIG_FILE=preview.yml` selects the HTTP-only Traefik config.
- `PROXY_ENTRYPOINT=web`, `PROXY_TLS=false` make routers serve over HTTP.
- `AUTH_MODE=mock` (no real OAuth issuer).
- Hardcoded postgres credentials so the in-stack `postgres` services match
  `DATABASE_URL` / `ONCHAIN_DATABASE_URL`.
- `AUTH_TOKEN_ENCRYPTION_KEY` is generated per-deploy.
- `TEMPORAL_ENABLE_ES=true` (preview keeps Elasticsearch).

If you need to deploy a preview by hand:

```bash
COMPOSE_PROFILES=apps,infra,storage \
COMPOSE_NETWORK_NAME=reputo \
IMAGE_TAG=preview-<commit> \
TRAEFIK_CONFIG_FILE=preview.yml \
PROXY_ENTRYPOINT=web PROXY_TLS=false \
AUTH_MODE=mock OWNER_EMAIL=preview@example.com \
APP_AWS_ACCESS_KEY_ID=minio APP_AWS_SECRET_ACCESS_KEY=minio12345preview \
MINIO_ROOT_USER=minio MINIO_ROOT_PASSWORD=minio12345preview \
STORAGE_ENDPOINT=http://minio:9000 STORAGE_FORCE_PATH_STYLE=true \
STORAGE_BUCKET=reputo-preview \
# ... (see pull-preview.yml for the full env list)
docker compose -f docker/compose/compose.yml up -d
```
