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

## Toolchain

- Node `24.15.0` is pinned in `.nvmrc` (CI reads it directly) and mirrored in `mise.toml` + each `Dockerfile`'s `ARG NODE_VERSION`. `make doctor` flags drift between them.
- pnpm version comes from `package.json` `packageManager` — Corepack picks it up locally, `pnpm/action-setup@v4` picks it up in CI.
- Turbo orchestrates workspace builds.
- `pnpm check` runs Biome (lint + format), `pnpm test` runs Vitest, `pnpm build` runs the per-workspace build.
- Use `pnpm --filter <workspace> <script>` to target a single app or package.
- Prefer the top-level `Makefile` for stack and infra commands (`make up`, `make doctor`, `make logs api`, etc.).
