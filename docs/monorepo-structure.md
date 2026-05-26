# Monorepo structure

Reputo is a pnpm workspace built with [Turbo](https://turborepo.com).

## Apps

| Workspace | What it does | README |
| --- | --- | --- |
| `@reputo/api` | HTTP API and Temporal activity worker. Owns the application Postgres database. | [apps/api/README.md](../apps/api/README.md) |
| `@reputo/ui` | Next.js dashboard. Calls the API at `/api/v1` and listens to snapshot events. | [apps/ui/README.md](../apps/ui/README.md) |
| `@reputo/workflows` | Temporal workers for orchestration, algorithms, and onchain-data sync. | [apps/workflows/README.md](../apps/workflows/README.md) |

## Packages

| Workspace | What it does | README |
| --- | --- | --- |
| `@reputo/reputation-algorithms` | Versioned algorithm registry and lookup API. | [packages/reputation-algorithms/README.md](../packages/reputation-algorithms/README.md) |
| `@reputo/algorithm-validator` | Zod schemas for algorithm payloads and CSV checks. | [packages/algorithm-validator/README.md](../packages/algorithm-validator/README.md) |
| `@reputo/contracts` | Wire DTOs, enums, and Temporal activity I/O shared by API and Workflows. | [packages/contracts/README.md](../packages/contracts/README.md) |
| `@reputo/storage` | S3 client with presigned upload and download helpers. | [packages/storage/README.md](../packages/storage/README.md) |
| `@reputo/onchain-data` | EVM and Cardano transfer sync, stored in PostgreSQL (TypeORM). | [packages/onchain-data/README.md](../packages/onchain-data/README.md) |
| `@reputo/deepfunding-portal-api` | DeepFunding Portal API client and SQLite ingest. | [packages/deepfunding-portal-api/README.md](../packages/deepfunding-portal-api/README.md) |

## Tooling

- **Package manager**: pnpm `10.30.3` (pinned in [`mise.toml`](../mise.toml)).
- **Runtime**: Node `24.14.0`.
- **Build orchestration**: Turbo ([`turbo.json`](../turbo.json)).
- **Lint and format**: Biome ([`biome.json`](../biome.json)).
- **Tests**: Vitest ([`vitest.base.ts`](../vitest.base.ts)).
