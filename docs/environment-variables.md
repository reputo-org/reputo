# Environment variables

Reputo uses one `.env` file at the repo root for local development. Each app validates its own variables with Zod at startup.

## Files

| Path | Purpose |
| --- | --- |
| [`.env.example`](../.env.example) | Tracked template. Lists every variable with `REQUIRED`, `OPTIONAL`, or `SECRET` notes. The single source of truth for local development. |
| `.env` | Local copy. Git-ignored. Create it from `.env.example`. |
| [`infra/komodo/resources/variables.toml`](../infra/komodo/resources/variables.toml) | Komodo Variable shells for staging and production. Names live here; values are set in the Komodo UI. |
| `infra/komodo/stacks/<name>/stack.toml` `environment` block | Maps Komodo Variables into stack environment at deploy time. The staging/production runtime contract for that stack. |

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
3. The `environment:` block in the relevant Compose file:
   - [`infra/dev/compose.yml`](../infra/dev/compose.yml) for local Docker.
   - The matching `infra/komodo/stacks/<name>/compose.yml` for staging and production.
   - [`infra/preview/compose.yml`](../infra/preview/compose.yml) for PullPreview.
4. [`infra/komodo/resources/variables.toml`](../infra/komodo/resources/variables.toml) and the matching stack `environment` block in [`infra/komodo/stacks/<name>/stack.toml`](../infra/komodo/stacks/).

Secrets (`*_SECRET`, `*_KEY`, `*_PASSWORD`, `*_TOKEN`) use `z.string().min(1)` and must never appear in logs.
