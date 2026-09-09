# Monorepo structure

Reputo is a pnpm workspace built with [Turbo](https://turborepo.com). Each workspace has its own `README.md` and `AGENTS.md`.

## Apps

| Workspace | What it does | README |
| --- | --- | --- |
| `@reputo/api` | HTTP API, the application database, community connections, and the Temporal worker for database activities. | [apps/api/README.md](../apps/api/README.md) |
| `@reputo/ui` | Next.js dashboard. Calls the API at `/api/v1` and follows snapshot and connection events. | [apps/ui/README.md](../apps/ui/README.md) |
| `@reputo/workflows` | Temporal workers: orchestrator, algorithms, onchain-data sync, and community fetches. | [apps/workflows/README.md](../apps/workflows/README.md) |

## Packages

| Workspace | What it does | README |
| --- | --- | --- |
| `@reputo/reputation-algorithms` | Versioned algorithm registry and lookup API. | [README](../packages/reputation-algorithms/README.md) |
| `@reputo/algorithm-validator` | Zod schemas for presets and CSV checks. | [README](../packages/algorithm-validator/README.md) |
| `@reputo/contracts` | DTOs, enums, and Temporal activity types shared by the API and Workflows. | [README](../packages/contracts/README.md) |
| `@reputo/storage` | S3 client with presigned upload and download helpers. | [README](../packages/storage/README.md) |
| `@reputo/onchain-data` | EVM and Cardano transfer sync into PostgreSQL. | [README](../packages/onchain-data/README.md) |
| `@reputo/deepfunding-portal-api` | Deep Funding Portal API client and SQLite ingest. | [README](../packages/deepfunding-portal-api/README.md) |
| `@reputo/deep-id-api` | DeepID Client API client: consented users, score posting, encrypted scores. | [README](../packages/deep-id-api/README.md) |
| `@reputo/community-api` | Read-only Discord, GitHub, and Mattermost clients and adapters, credential sealing, and the safe outbound fetch. | [README](../packages/community-api/README.md) |

## Import rules

- Apps import packages. Packages never import apps.
- Workflows depend on `@reputo/contracts` for everything shared with the API, never on `apps/api` internals.
- Import a package from its public entry only. Do not deep-import `src/` paths.

## Tooling

| Tool | Version or config |
| --- | --- |
| Node | `24.15.0`, pinned in [`mise.toml`](../mise.toml) |
| pnpm | `11.13.0`, pinned in [`mise.toml`](../mise.toml) |
| Turbo | [`turbo.json`](../turbo.json) |
| Biome (lint and format) | [`biome.json`](../biome.json) |
| Vitest | [`vitest.base.ts`](../vitest.base.ts) |
