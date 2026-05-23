# @reputo/env

Framework-agnostic Zod schemas for cross-app env shapes in the Reputo ecosystem.

Apps (`@reputo/api`, `@reputo/workflows`, `@reputo/ui`) compose these schemas
into their own app-specific schema, then parse `process.env` at boot.

## Public API

- `runtimeEnvSchema` — `NODE_ENV`, `LOG_LEVEL`
- `awsEnvSchema` — `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (both-or-neither)
- `storageEnvSchema` — `STORAGE_BUCKET`, `STORAGE_PRESIGN_*_TTL`, `STORAGE_MAX_SIZE_BYTES`, `STORAGE_CONTENT_TYPE_ALLOWLIST`
- `temporalEnvSchema` + `taskQueueSchema(envVarName, defaultValue)`
- `loggerEnvSchema` — re-export of the `LOG_LEVEL` field
- `secretString()` — branded `z.string().min(1)` (rejects empty strings)
- `parseEnv(schema, env)` — boot-time runner with readable error messages
- `generateEnvExample(schema)` — emits a `.env.example`-shaped string from a schema

## Conventions

- Pure functions — the package never reads `process.env` itself. Apps pass `process.env` at the call site.
- Catalog Zod (`zod: ^4.1.0`) only.
- Every leaf must have `.describe()` so `generateEnvExample` emits a useful comment.
