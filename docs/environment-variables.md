# Environment variables

Reputo uses one `.env` file at the repo root for local development. Each app validates its own variables with Zod at startup.

## Files

| Path | Purpose |
| --- | --- |
| [`.env.example`](../.env.example) | Tracked template. Lists every variable with `REQUIRED`, `OPTIONAL`, or `SECRET` notes. |
| `.env` | Local copy. Git-ignored. Create it from `.env.example`. |

## Where each app validates env

Each app has one Zod schema. No other code reads `process.env`.

| App | Schema file |
| --- | --- |
| `@reputo/api` | [`apps/api/src/config/env.ts`](../apps/api/src/config/env.ts) |
| `@reputo/ui` | [`apps/ui/src/lib/env.ts`](../apps/ui/src/lib/env.ts) |
| `@reputo/workflows` | [`apps/workflows/src/config/env.ts`](../apps/workflows/src/config/env.ts) |

If a value is missing or invalid, the app fails to start with a clear error.

## Add or change a variable

A new variable lands in one pull request that updates **all four** sources:

1. The app's Zod schema (file above).
2. The root [`.env.example`](../.env.example).
3. The `environment:` block in both Compose files:
   - [`docker/compose/compose.dev.yml`](../docker/compose/compose.dev.yml) for local Docker.
   - [`docker/compose/compose.yml`](../docker/compose/compose.yml) for staging, production, and preview.
4. [`komodo/resources/variables.toml`](../komodo/resources/variables.toml) and the matching stack `environment` block in [`komodo/resources/stacks/apps.toml`](../komodo/resources/stacks/apps.toml) or [`infra.toml`](../komodo/resources/stacks/infra.toml).

Secrets (`*_SECRET`, `*_KEY`, `*_PASSWORD`, `*_TOKEN`) use `z.string().min(1)` and must never appear in logs.
