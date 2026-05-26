# Docker stack

Reputo runs in Docker for local development, preview, staging, and production. The Compose files live under [`docker/compose/`](../docker/compose/).



## Compose profiles

`compose.yml` is the single source of truth for every non-local environment. Service selection uses `COMPOSE_PROFILES`:

| Profile | Services |
| --- | --- |
| `apps` | `api`, `ui`, `orchestrator-worker`, `onchain-data-worker`, `typescript-worker` |
| `infra` | `traefik`, `temporal`, `temporal-ui`, `temporal-elasticsearch`, `temporal-postgresql`, `postgres`, `onchain-data-postgresql` |
| `observability` | `loki`, `promtail`, `prometheus`, `cadvisor`, `node-exporter`, `grafana` |
| `storage` | `minio` and `minio-init` (S3-compatible storage for dev and preview) |

Profiles per environment:

- `reputo-apps-*` Komodo stacks: `COMPOSE_PROFILES=apps`.
- `reputo-infra-*` Komodo stacks: `COMPOSE_PROFILES=infra,observability`.
- PullPreview: `COMPOSE_PROFILES=apps,infra,storage`.

Staging and production do **not** start the `storage` profile. They use real AWS S3 through the SDK default credential chain (IAM role). MinIO exists only in dev (part of the `infra` profile in `compose.dev.yml`, always on) and preview (`storage` profile in `compose.yml`).


### Useful local endpoints

| Service | URL or command |
| --- | --- |
| UI | <http://localhost:4000> |
| API | <http://localhost:3000> |
| Temporal UI | <http://localhost:8088> |
| MinIO console | <http://localhost:9001> (login `minio` / `minio12345`) |
| App Postgres | `psql postgresql://reputo_app:reputo_app@localhost:5434/reputo_app` |
| Onchain Postgres | `psql postgresql://reputo_onchain:reputo_onchain@localhost:5433/reputo_onchain` |
