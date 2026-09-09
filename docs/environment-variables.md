# Environment variables

Reputo uses one `.env` file at the repo root for local development. Each app validates its own variables with Zod at startup and fails with a clear error when a value is missing or invalid.

## Files

| Path | Purpose |
| --- | --- |
| [`.env.example`](../.env.example) | Tracked local template with `REQUIRED`, `OPTIONAL`, and `SECRET` notes. |
| `.env` | Your local copy. Git-ignored. |
| [`infra/komodo/resources/variables.toml`](../infra/komodo/resources/variables.toml) | Variable names for staging and production. Values are set in the Komodo UI. |
| `infra/komodo/stacks/<name>/stack.toml` | Maps Komodo variables into a stack's environment at deploy time. |

## Where each app validates

| App | Schema |
| --- | --- |
| `@reputo/api` | [`apps/api/src/config/env.ts`](../apps/api/src/config/env.ts) |
| `@reputo/ui` | [`apps/ui/src/lib/env.ts`](../apps/ui/src/lib/env.ts) |
| `@reputo/workflows` | [`apps/workflows/src/config/env.ts`](../apps/workflows/src/config/env.ts) |

Application configuration should use these schemas. Small adapters, such as health build metadata and the TypeORM CLI, document their direct environment reads in code.

## Add or change a variable

Update all four sources in one pull request:

1. The app's Zod schema.
2. [`.env.example`](../.env.example).
3. The `environment:` block of every Compose file that runs the app: [`infra/dev/compose.yml`](../infra/dev/compose.yml), [`infra/preview/compose.yml`](../infra/preview/compose.yml), and the matching `infra/komodo/stacks/<name>/compose.yml`.
4. [`variables.toml`](../infra/komodo/resources/variables.toml) and the stack's `stack.toml`.

Secrets (`*_SECRET`, `*_KEY`, `*_PASSWORD`, `*_TOKEN`) use `z.string().min(1)` and must never appear in logs. The community and DeepID variables are explained in [Community platform setup](community-platform-setup.md) and [DeepID integration](deep-id-integration.md).
