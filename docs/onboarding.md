# Onboarding

Clone → working stack in under 15 minutes. One command, one credentials checklist.

## 0. Install the toolchain

Use [mise](https://mise.jdx.dev/getting-started.html) to get the exact pinned versions of Node, jq, and the task runner. From the repo root:

```bash
mise trust
mise install
```

That covers Node `24.15.0` and `jq`. pnpm is **not** pinned in `mise.toml` — its version lives in the `packageManager` field of `package.json` (currently `pnpm@10.30.3`) and is installed automatically by Corepack on first use. Same single source of truth on dev machines and in CI.

If you use `nvm` or install Node manually instead, read `.nvmrc` and match the version yourself, then run `corepack enable` once.

You also need Docker Desktop (or Docker Engine + Compose plugin) running locally.

Verify:

```bash
make doctor
```

`doctor` checks tool versions and warns about port conflicts before you start the stack.

## 1. Bootstrap

```bash
pnpm install --frozen-lockfile
make bootstrap
```

`make bootstrap` copies every `docker/env/examples/*.env.example` to `docker/env/*.env`, generates a real `AUTH_TOKEN_ENCRYPTION_KEY`, and prints a credentials checklist with the current status of every value. It is idempotent — re-running never overwrites a file you already edited.

## 2. Add credentials you need

The local stack runs entirely on local services (MinIO instead of S3, mock auth instead of DeepID), so **no third-party credentials are required for first run**. You only need real credentials for the features that hit external APIs:

| Required for | Credential | Lives in |
| --- | --- | --- |
| First run, full stack | _nothing_ | — |
| Snapshot upload/download | _MinIO; auto-configured_ | `docker/env/minio.env` |
| DeepFunding algorithms | `DEEPFUNDING_API_KEY` | `docker/env/workflows.env` |
| EVM on-chain sync | `ALCHEMY_API_KEY` | `docker/env/workflows.env` |
| Cardano on-chain sync | `BLOCKFROST_API_KEY` | `docker/env/workflows.env` |
| Real DeepID OAuth login | `DEEP_ID_CLIENT_*`, switch `AUTH_MODE=oauth` | `docker/env/api.env` |

See [credentials.md](credentials.md) for the full inventory, including the staging/production keys.

## 3. Start the stack

```bash
make up           # detached
make logs SVC=api # tail a service (override SVC=ui|workflows|mongodb|...)
make ps           # see what's running
make down         # stop, preserve volumes
make nuke         # stop and delete all volumes (irreversible)
```

When everything is healthy:

| Surface | URL | Credentials |
| --- | --- | --- |
| UI | <http://localhost> | mock auth — enter any email |
| API | <http://localhost/api> | — |
| API reference (Scalar) | <http://localhost/api/reference> | — |
| Traefik dashboard | <http://localhost:8080/dashboard/> | — |
| Temporal UI | <http://localhost:8088> | — |
| Grafana | <http://localhost:3001> | `admin` / `admin` |
| MinIO console | <http://minio.localhost> | `reputo` / `reputo-dev-secret` |

## 4. Day-to-day commands

```bash
make test          # vitest
make check         # biome lint + format check
make build         # turbo build every workspace
make typecheck     # tsc --noEmit per workspace
make shell SVC=api # exec bash inside a running container
make images        # rebuild api/ui/workflows images locally (matches CI)
```

For per-workspace work prefer `pnpm --filter @reputo/<workspace> <script>` — see [AGENTS.md](../AGENTS.md).

## 5. When something is wrong

- `make doctor` first.
- `make logs SVC=<service>` for the offending container.
- If MongoDB refuses to start, check that `MONGODB_USER`/`MONGODB_PASSWORD` in `api.env` and `workflows.env` match `MONGO_INITDB_ROOT_USERNAME`/`MONGO_INITDB_ROOT_PASSWORD` in `mongodb.env`. They must match.
- If MinIO is healthy but uploads fail with `403`, the bucket may have been renamed in `api.env`/`workflows.env` without a matching entry in `minio.env` `MINIO_BUCKETS`. Run `make minio-init`.
- Volumes are persisted across `make down`. If a database is in a wedged state, `make nuke` will wipe it.

## 6. Deeper docs

- [docker/README.md](../docker/README.md) — Compose file layout and what each stack contains.
- [komodo/README.md](../komodo/README.md) — How we deploy to staging and production today.
- [docs/handoff/](handoff/) — How a successor operator stands the same stack up on their own infra without Komodo.
- [docs/runbooks/](runbooks/) — Operational runbooks (access rollout, etc.).
- [AGENTS.md](../AGENTS.md) — Repo conventions for code and PRs.
