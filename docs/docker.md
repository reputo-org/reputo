# Docker stack

Reputo runs in Docker for local development, preview, staging, and production. Each Compose file lives next to whatever consumes it.

| Environment | Compose location | Driver |
| --- | --- | --- |
| Local dev | [`infra/dev/compose.yml`](../infra/dev/compose.yml) | `pnpm docker:up` (loads root `.env`) |
| PullPreview | [`infra/preview/compose.yml`](../infra/preview/compose.yml) | `pullpreview/action` on a Lightsail VM |
| Staging / production | [`infra/komodo/stacks/<name>/compose.yml`](../infra/komodo/stacks/) | Komodo Stacks |

## Staging / production stacks

Staging and production run four separate Komodo Stacks per environment, each with its own folder under [`infra/komodo/stacks/`](../infra/komodo/stacks/). All four join the shared external bridge network `reputo`.

| Stack | Folder | Services |
| --- | --- | --- |
| `reputo-database-{env}` | [`stacks/database/`](../infra/komodo/stacks/database/) | `postgres`, `onchain-data-postgresql`, on-demand `postgres-backup` |
| `reputo-temporal-{env}` | [`stacks/temporal/`](../infra/komodo/stacks/temporal/) | `temporal`, `temporal-ui`, `temporal-postgresql`, `temporal-elasticsearch` |
| `reputo-observability-{env}` | [`stacks/observability/`](../infra/komodo/stacks/observability/) | `loki`, `promtail`, `prometheus`, `cadvisor`, `node-exporter`, `grafana` |
| `reputo-apps-{env}` | [`stacks/apps/`](../infra/komodo/stacks/apps/) | `traefik`, `ui`, `api`, `orchestrator-worker`, `onchain-data-worker`, `typescript-worker` |

Each stack folder contains its `stack.toml` (Komodo Stack definition), `compose.yml` (what Periphery runs), `.env.example` (env contract), and any service config (`config/...`) that only that stack consumes. See [infra/komodo/README.md](../infra/komodo/README.md) for the split rationale and [Komodo operations](komodo.md) for deploy/RBAC details.

## Local development

`infra/dev/compose.yml` still uses profile selection because dev runs everything on one machine:

| Profile | Services |
| --- | --- |
| `apps` | api, ui, workers |
| `infra` | traefik, temporal stack, both Postgres flavours, MinIO |

Useful local endpoints:

| Service | URL or command |
| --- | --- |
| UI | <http://localhost:4000> |
| API | <http://localhost:3000> |
| Temporal UI | <http://localhost:8088> |
| MinIO console | <http://localhost:9001> (login `minio` / `minio12345`) |
| App Postgres | `psql postgresql://reputo_app:reputo_app@localhost:5434/reputo_app` |
| Onchain Postgres | `psql postgresql://reputo_onchain:reputo_onchain@localhost:5433/reputo_onchain` |
