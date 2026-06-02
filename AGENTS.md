# Reputo

Reputo is Monorepo of modular, privacy‑preserving reputation platform. A user defines an
algorithm _preset_, starts a _snapshot_, and Temporal workers compute a reputation score off the
request path and store the result; the API and UI surface it. This is a pnpm + Turbo monorepo for
the three apps and the libraries they share.

## Layout

- `apps/` — deployables. Each has its own `AGENTS.md` and `README.md`.
    - `@reputo/api` — NestJS HTTP API; owns the application Postgres DB; hosts the snapshot Temporal worker.
    - `@reputo/ui` — Next.js dashboard; talks to the API over same-origin and SSE.
    - `@reputo/workflows` — Temporal workers that orchestrate snapshots and run algorithms.
- `packages/` — standalone libraries the apps build on. Each has its own `AGENTS.md` and `README.md`.

Full app/package table: [docs/monorepo-structure.md](docs/monorepo-structure.md).

## Toolchain

- **mise** pins the Node and pnpm versions — install them with `mise install` (or `mise run setup`). Use **pnpm**, never npm.
- **Turbo** runs per-workspace `build`/`test`/`check`; **Biome** does lint + format; **Vitest** runs tests.
- **Temporal** orchestrates work; **TypeORM** is the ORM wherever a workspace owns a database; **Zod** validates env.
- Shared dependency versions live in the pnpm **catalog** (`pnpm-workspace.yaml`) and are referenced as `catalog:`.

## Common commands (from the repo root)

```bash
mise run setup          # first time: install tools, copy .env.example -> .env, pnpm install
pnpm dev                # run api + ui + workflows in watch mode (loads .env)
pnpm docker:up          # whole stack in Docker (docker:up:infra for just Temporal/Postgres/MinIO)
pnpm db:migrate         # apply API database migrations
pnpm check              # Biome lint + format
pnpm test               # Vitest across the repo
pnpm build              # Turbo build of every workspace
pnpm --filter <ws> <s>  # run script <s> in one workspace, e.g. pnpm --filter @reputo/api test
pnpm algorithm:create <key> <version>   # scaffold a new reputation algorithm
```

Verify a change with `pnpm check && pnpm test`.
Environment is validated per app (see each app's README); the template is `.env.example`.

## Docs

Guides live in [docs/](docs/README.md), read each if it is relevant to task.
