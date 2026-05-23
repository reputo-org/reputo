# Package Instructions

- `packages/` are reusable libraries, not app glue.
- Never import from `apps/`.
- Export stable public APIs from `src/index.ts`.
- Prefer cross-package imports from package entrypoints instead of deep internal paths.
- Stay framework-agnostic unless a package is intentionally framework-specific.
- Keep explicit types at exported boundaries.
- When exported behavior changes, update the relevant package tests.
- Persistence-owning packages (`@reputo/onchain-data`, `@reputo/deepfunding-portal-api`) use TypeORM. Follow [docs/runbooks/typeorm-conventions.md](../docs/runbooks/typeorm-conventions.md) for entity, DataSource, migration, and JSON-vs-relational decisions.
