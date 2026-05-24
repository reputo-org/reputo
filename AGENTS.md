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
- TypeORM is the standard ORM across `@reputo/api`, `@reputo/onchain-data`, and `@reputo/deepfunding-portal-api`.

## Environment variables

- Each app validates its environment in exactly one module:
  - `apps/api/src/config/env.ts`
  - `apps/workflows/src/config/env.ts`
  - `apps/ui/src/lib/env.ts`
- That module is the **single source of truth**. No other code may read `process.env.*` directly. No downstream re-validation.
- All apps use Zod (workspace catalog version). No other validators.
- Local dev: the tracked root `.env.example` is the only template; copy to `.env`. `scripts/env/load.ts` loads it for `pnpm dev` and `pnpm docker:dev`.
- Staging/production: Komodo Variables (`komodo/resources/variables.toml`) are authoritative; the prod compose files carry no `env_file:` directives.
- Adding or changing an env var requires updating, in one PR: the app's Zod schema, the root `.env.example`, the per-service `environment:` block in `docker/compose/dev.yml` (for dev) and `apps.yml`/`infra.yml` (for prod), and `komodo/resources/variables.toml`.
- Secrets (`*_SECRET`, `*_KEY`, `*_PASSWORD`, `*_TOKEN`) must use `z.string().min(1)` (no empty strings) and must never be logged.

## Toolchain

- Node 20+ with `pnpm@10.30.3`; Turbo orchestrates workspace builds.
- `pnpm check` runs Biome (lint + format), `pnpm test` runs Vitest, `pnpm build` runs the per-workspace build.
- Use `pnpm --filter <workspace> <script>` to target a single app or package.
