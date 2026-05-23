# Env validation convention

This runbook is the canonical reference for how Reputo apps validate their
environment. It is owned by Milestone 9 ("Env hardening & secret hygiene")
and supersedes the earlier shared-package idea (`packages/env`, removed).

The convention is enforced by:

- This document (copy-pasteable canonical snippets).
- Root and per-app `AGENTS.md` files.
- The CI drift check (Milestone 9, Task 8).

For runtime env precedence (compose, env files, per-app `.env`), see
[env-precedence.md](./env-precedence.md).

---

## 1. File-location rule

Each app validates its env in exactly one module:

| App              | Env module path                       |
| ---------------- | ------------------------------------- |
| `apps/api`       | `apps/api/src/config/env.ts`          |
| `apps/workflows` | `apps/workflows/src/config/env.ts`    |
| `apps/ui`        | `apps/ui/src/lib/env.ts`              |

That module is the **single source of truth**. No other code may read
`process.env.*` directly. No downstream re-validation of parsed values.

## 2. Module-shape rule

Every env module exports the same shape:

- `envSchema` — the raw Zod schema (used by the CI drift check to generate
  the expected `envs.example`).
- `env` — the parsed, fully typed config object.

Rules:

- The module reads `process.env` **exactly once**, immediately validates it,
  and exports the parsed result.
- Every leaf field has a `.describe('...')` call. The drift check uses these
  as the comments in the generated `envs.example`.
- On parse failure, write a readable `KEY: reason` list to `stderr` and
  either `process.exit(1)` (server entry points) or rethrow (Next.js, where
  exiting from a build worker is hostile). Never swallow the error.

### Canonical module skeleton

```ts
// apps/<app>/src/config/env.ts (or apps/ui/src/lib/env.ts)
import { z } from 'zod';

export const envSchema = z.object({
  // ... fields go here (see §3 for canonical snippets)
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((issue) => {
    const key = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    return `  - ${key}: ${issue.message}`;
  });
  process.stderr.write(`Invalid environment variables:\n${lines.join('\n')}\n`);
  process.exit(1); // UI module: throw new Error(...) instead.
}

export const env = parsed.data;
```

## 3. Canonical Zod snippets

Copy these verbatim. If you need to change a cross-cutting shape, update
this doc in the same PR so every app picks the same definition next time.

### 3.1 `NODE_ENV`

```ts
export const NODE_ENVS = ['production', 'development', 'test'] as const;

const runtime = {
  NODE_ENV: z.enum(NODE_ENVS).describe('Node runtime environment'),
};
```

### 3.2 `LOG_LEVEL`

```ts
export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
] as const;

const logger = {
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info').describe('Pino log level'),
};
```

### 3.3 AWS — region + optional credentials (both-or-neither)

`AWS_REGION` is required; the access-key pair is optional (containers in
EKS/ECS use IAM role credentials). Supplying only one of the two is a
misconfiguration that would silently fall back to the role — the `.refine`
catches that.

```ts
const aws = z
  .object({
    AWS_REGION: z.string().min(1).describe('AWS region for S3 and other AWS clients'),
    AWS_ACCESS_KEY_ID: z
      .string()
      .min(1)
      .optional()
      .describe('AWS access key ID (omit to use IAM role credentials)'),
    AWS_SECRET_ACCESS_KEY: z
      .string()
      .min(1)
      .optional()
      .describe('AWS secret access key (omit to use IAM role credentials)'),
  })
  .refine(
    (e) =>
      (e.AWS_ACCESS_KEY_ID === undefined && e.AWS_SECRET_ACCESS_KEY === undefined) ||
      (e.AWS_ACCESS_KEY_ID !== undefined && e.AWS_SECRET_ACCESS_KEY !== undefined),
    {
      error:
        'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set together or both omitted',
      path: ['AWS_ACCESS_KEY_ID'],
    },
  );
```

### 3.4 S3-backed storage (5 vars, allowlist transforms to `string[]`)

```ts
const storage = z.object({
  STORAGE_BUCKET: z
    .string()
    .min(1)
    .describe('S3 bucket name for algorithm inputs and outputs'),
  STORAGE_PRESIGN_PUT_TTL: z.coerce
    .number()
    .int()
    .positive()
    .default(120)
    .describe('Presigned PUT URL TTL in seconds'),
  STORAGE_PRESIGN_GET_TTL: z.coerce
    .number()
    .int()
    .positive()
    .default(300)
    .describe('Presigned GET URL TTL in seconds'),
  STORAGE_MAX_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(52_428_800) // 50 MiB
    .describe('Maximum object size in bytes'),
  STORAGE_CONTENT_TYPE_ALLOWLIST: z
    .string()
    .min(1)
    .default('text/csv,text/plain,application/json')
    .describe('Comma-separated MIME allowlist (parsed to string[])')
    .transform((csv) =>
      csv
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
});
```

### 3.5 Temporal — address/namespace + per-app task queues

`TEMPORAL_ADDRESS` and `TEMPORAL_NAMESPACE` are shared. Task-queue env vars
are app-specific (each worker host owns its own set), so build them with
the `taskQueue` helper and `.merge()` them into the app schema.

```ts
const temporal = z.object({
  TEMPORAL_ADDRESS: z.string().min(1).describe('Temporal server address (host:port)'),
  TEMPORAL_NAMESPACE: z.string().min(1).default('default').describe('Temporal namespace'),
});

function taskQueue<Name extends string>(name: Name, defaultValue: string) {
  return z.object({
    [name]: z
      .string()
      .min(1)
      .default(defaultValue)
      .describe(`Temporal task queue: ${name}`),
  } as Record<Name, z.ZodDefault<z.ZodString>>);
}

// usage:
const workflowsEnv = temporal
  .merge(taskQueue('TEMPORAL_ORCHESTRATOR_TASK_QUEUE', 'workflows'))
  .merge(taskQueue('TEMPORAL_ONCHAIN_DATA_TASK_QUEUE', 'onchain-data'));
```

Defaults for task-queue names live in `@reputo/contracts` — import the
constant rather than hard-coding the string literal.

## 4. Secret rule

Any env var whose name ends in `_SECRET`, `_KEY`, `_PASSWORD`, or `_TOKEN`
is treated as a secret:

- Schema must be `z.string().min(1)` (no empty strings, no `.allow('')`-style
  escape hatches — closes audit issue M4 from Milestone 9).
- Never log the value. Never include it in error messages, traces, or
  pino's serialised output.
- Never check it into git. Live values come from `docker/env/*.env`
  (gitignored), CI secrets, Komodo UI, or the preview-secret pipeline
  (see [env-precedence.md](./env-precedence.md)).
- Treat the optional/required distinction conservatively: if the secret is
  optional (e.g. AWS keys when running with an IAM role), use
  `z.string().min(1).optional()` so an accidental empty string is still
  rejected.

```ts
DEEPFUNDING_API_KEY: z
  .string()
  .min(1)
  .describe('DeepFunding API key (required for the orchestrator worker)'),
```

## 5. Discipline rules

These are enforced by code review today and by the CI drift check
(Milestone 9 Task 8) once it lands.

1. **No `process.env.*` outside the env module.** Import `env` from the
   module instead. The only acceptable exceptions are bootstrap files that
   the env module itself depends on (e.g. `dotenv/config` preloads).
2. **No downstream re-validation.** If a downstream module needs a more
   constrained type (e.g. a `URL` instead of a `string`), build it inside
   the env module via `.transform()` and export the already-narrowed value.
3. **One-PR rule for env changes.** Adding or changing an env var requires
   updating, in the same PR:
   - the app's `envSchema`,
   - the app's `envs.example`,
   - every `docker/env/*.env*` file the var appears in,
   - the `docker/compose/apps.yml` anchor (if the var is set via compose),
   - the Komodo variable list in `komodo/resources/variables.toml` (if the
     var ships to staging/production).
4. **Cross-app cross-cutting vars stay in sync via this doc.** The shapes
   for `NODE_ENV`, `LOG_LEVEL`, AWS, storage, and Temporal are duplicated
   across apps by design (no shared package, no release-cadence coupling).
   When a cross-cutting shape changes, update §3 here and roll the change
   through every app's `envSchema` in the same PR.
