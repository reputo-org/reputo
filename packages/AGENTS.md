# packages/

Reusable libraries the apps build on. Each package is framework-agnostic (no Nest or Next), exposes
its public API from `src/index.ts`, and is consumed by the apps under its `@reputo/*` name.

Every package shares the same workflow:

```bash
pnpm --filter <pkg> build      # tsc -> dist/
pnpm --filter <pkg> test       # Vitest
pnpm --filter <pkg> docs       # typedoc API reference -> docs/
```

Each package has its own `AGENTS.md` and `README.md`.
