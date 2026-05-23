# Reputo Instructions

- `apps/` are deployables: `api`, `ui`, and `workflows`.
- `packages/` are reusable libraries.
- Run workspace scripts from the repo root with `pnpm --filter <workspace> ...`.
- `packages/` must never import from `apps/`.
- `apps/` may depend on `packages/`, but not on sibling apps.
- Prefer package public entrypoints over deep internal imports.
- Keep explicit types at public boundaries.
- If behavior changes, update or add tests.
- Never put secrets, tokens, or credentials in code or logs.
- Keep diffs focused and PR-sized.
- For any DB-touching change, follow [docs/runbooks/typeorm-conventions.md](docs/runbooks/typeorm-conventions.md). TypeORM is the standard ORM across `@reputo/api`, `@reputo/onchain-data`, and `@reputo/deepfunding-portal-api`.

## Environment variables

- Each app validates its environment in exactly one module:
  - `apps/api/src/config/env.ts`
  - `apps/workflows/src/config/env.ts`
  - `apps/ui/src/lib/env.ts`
- That module is the **single source of truth**. No other code may read `process.env.*` directly. No downstream re-validation.
- All apps use Zod (workspace catalog version). No other validators.
- Adding or changing an env var requires updating, in one PR: the schema, the app's `envs.example`, every `docker/env/*.env*` file where it appears, and the `docker/compose/apps.yml` anchor.
- Secrets (`*_SECRET`, `*_KEY`, `*_PASSWORD`, `*_TOKEN`) must use `z.string().min(1)` (no empty strings) and must never be logged.
- Full convention: [docs/runbooks/env-validation.md](docs/runbooks/env-validation.md).

## Toolchain

- Node 20+ with `pnpm@10.30.3`; Turbo orchestrates workspace builds.
- `pnpm check` runs Biome (lint + format), `pnpm test` runs Vitest, `pnpm build` runs the per-workspace build.
- Use `pnpm --filter <workspace> <script>` to target a single app or package.
