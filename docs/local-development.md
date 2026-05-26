# Local development

This guide gets the Reputo monorepo running on your machine.

## Requirements

- Docker Desktop, or Docker Engine plus the Compose plugin.
- [mise](https://mise.jdx.dev) for the Node (`24.14.0`) and pnpm (`10.30.3`) versions pinned in [`mise.toml`](../mise.toml). Mise runs on macOS, Linux, and Windows.

Without mise, install the exact Node and pnpm versions yourself. Other versions are not supported.

## First-time setup

Install mise:

```bash
brew install mise            # macOS
# curl https://mise.run | sh # Linux / WSL
# winget install jdx.mise    # Windows
```

Run the setup task:

```bash
mise run setup               # installs Node + pnpm, copies .env.example -> .env, runs pnpm install
```

Open `.env` and fill in every empty value, especially `*_SECRET`, `*_KEY`, and `*_PASSWORD`. See [Environment variables](environment-variables.md) for the list.

Without mise:

```bash
cp .env.example .env
pnpm install
```

## Run the apps

The dev Compose file ([`infra/dev/compose.yml`](../infra/dev/compose.yml)) groups services into two profiles:

- `apps` — `api`, `ui`, `db-migrate`, and the three workflow workers. They run in containers with the repo bind-mounted into `/workspace` for hot reload.
- `infra` — Temporal (server, UI, Postgres, Elasticsearch), the app Postgres, the onchain-data Postgres, MinIO, and `minio-init`.

Pick one of the two flows.

### Full Docker

```bash
pnpm docker:up               # builds the dev image, starts both profiles
pnpm docker:down             # stops everything
```

### Hybrid

Run infrastructure in Docker and the apps natively. You get faster iteration, native debugging, and you can start only the apps you need.

```bash
pnpm docker:up:infra         # start Temporal, Postgres, MinIO
pnpm db:migrate              # apply pending migrations
pnpm dev                     # run api, ui, workflows in watch mode
pnpm docker:down             # stop infrastructure when done
```

### Local endpoints (both flows)

| Service | URL or command |
| --- | --- |
| UI | <http://localhost:4000> |
| API | <http://localhost:3000> |
| API reference | <http://localhost:3000/reference> |
| Temporal UI | <http://localhost:8088> |
| MinIO console | <http://localhost:9001> (login `minio` / `minio12345`) |
| App Postgres | `psql postgresql://reputo_app:reputo_app@localhost:5434/reputo_app` |
| Onchain Postgres | `psql postgresql://reputo_onchain:reputo_onchain@localhost:5433/reputo_onchain` |

## Common commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run all apps in watch mode. |
| `pnpm build` | Build every workspace through Turbo. |
| `pnpm check` | Run Biome (lint and format check). |
| `pnpm test` | Run Vitest across the repo. |
| `pnpm test:watch` | Vitest in watch mode. |
| `pnpm test:cov` | Vitest with coverage. |
| `pnpm typecheck` | Type-check every workspace. |
| `pnpm clean` | Remove `dist/`, `.turbo/`, and caches. |
| `pnpm algorithm:create <key> <version>` | Scaffold a new algorithm. See [Reputation algorithms](reputation-algorithms.md). |
| `pnpm algorithm:validate` | Validate the algorithm registry. |

