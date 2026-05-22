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

## Toolchain

- Node 20+ with `pnpm@10.30.3`; Turbo orchestrates workspace builds.
- `pnpm check` runs Biome (lint + format), `pnpm test` runs Vitest, `pnpm build` runs the per-workspace build.
- Use `pnpm --filter <workspace> <script>` to target a single app or package.
