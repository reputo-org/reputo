# Komodo deployment

Komodo is the deployment control plane for Reputo staging and production. This directory holds everything Git-tracked that Komodo needs.

```text
infra/komodo/
├── README.md                  # this file — operator overview
├── MIGRATION.md               # cutover steps from the old komodo/ layout
├── ROLLBACK.md                # how to roll back to the old layout
├── resource-sync.toml         # the single ResourceSync that fans out
├── procedures.toml            # every Procedure (deploy-*, restart-*, backup-*, etc.)
├── core/                      # Komodo Core compose + env template
│   ├── docker-compose.komodo.yml
│   └── core.env.example
├── periphery/                 # Periphery installer + env template
│   ├── install.sh
│   └── periphery.env.example
├── resources/                 # cross-cutting resource declarations
│   ├── servers.toml
│   ├── variables.toml
│   ├── user-groups.toml
│   └── alerters.toml
└── stacks/                    # one folder per Komodo Stack family
    ├── database/
    │   ├── stack.toml         # staging + production Stack TOMLs
    │   └── compose.yml        # the actual Compose file Periphery deploys
    ├── temporal/
    │   ├── stack.toml
    │   └── compose.yml
    ├── observability/
    │   ├── stack.toml
    │   ├── compose.yml
    │   └── config/            # Loki/Promtail/Prometheus/Grafana provisioning
    │       ├── loki-config.yml
    │       ├── promtail-config.yml
    │       ├── prometheus.yml
    │       └── grafana/provisioning/
    └── apps/
        ├── stack.toml
        ├── compose.yml
        └── config/
            └── traefik.yml
```

Each `stacks/<name>/` folder is self-contained: the Stack TOML, the Compose file it deploys, and any service-specific configs that only that stack consumes. Cross-cutting resources (servers, variables, user-groups, alerters) live at the root because they span every stack. Procedures sit at the root for the same reason — `deploy-all-*` and `deploy-infra-*` cross stack boundaries. There is no per-stack `.env.example`; the staging/production contract is the stack's `environment` block plus [resources/variables.toml](resources/variables.toml), and the dev contract is the root [`.env.example`](../../.env.example).

## Stack model

Four stacks per environment. Each is a separate Komodo Stack and a separate Docker Compose project on the host.

| Stack | Folder | What lives there |
| --- | --- | --- |
| `reputo-database-{env}` | [stacks/database/](stacks/database/) | API Postgres + onchain-data Postgres + on-demand `postgres-backup` |
| `reputo-temporal-{env}` | [stacks/temporal/](stacks/temporal/) | Temporal server, UI, Postgres, Elasticsearch |
| `reputo-observability-{env}` | [stacks/observability/](stacks/observability/) | Loki, Promtail, Prometheus, cAdvisor, node-exporter, Grafana |
| `reputo-apps-{env}` | [stacks/apps/](stacks/apps/) | Traefik, UI, API, workflow workers |

Why this split:

- **Statefulness:** each datastore (application Postgres, Temporal's own cluster, observability TSDBs) lives in its own stack so a restart of one does not bounce the others.
- **Lifecycle:** apps deploy on every merge to `main`; data and observability rarely move. Putting them in separate stacks keeps app deploys fast and low-blast-radius.
- **Ingress:** Traefik lives with apps because its labels and CORS middleware are reissued on every routing change. The Traefik container only restarts when its own config or env changes; service routes update via the Docker provider.

All four stacks join the shared external bridge network `${COMPOSE_NETWORK_NAME:-reputo}`, created on the host by the periphery installer.

## Source of truth

[resource-sync.toml](resource-sync.toml) at the root declares one `ResourceSync` named `reputo-main`. It scans `infra/komodo/resource-sync.toml`, `infra/komodo/procedures.toml`, `infra/komodo/resources/`, and `infra/komodo/stacks/` (recursing into each per-stack folder for `stack.toml` files).

Settings used:

- `managed = false`, `delete = false` — sync runs are reviewable and non-destructive.
- `include_resources = true`, `include_user_groups = true`.
- `include_variables = false` after first-time bootstrap (see [MIGRATION.md](MIGRATION.md)).

## Variables and secrets

Every value Komodo injects into a stack comes from Komodo Variables. [resources/variables.toml](resources/variables.toml) declares the *names* and `is_secret` flags; the values are filled in the Komodo UI (`Settings > Variables`). Each stack's TOML interpolates them as `[[NAME]]` references — resolved values never appear in this repo.

Variable conventions:

- Per-environment: prefix with `STAGING_` or `PRODUCTION_`.
- Cross-environment: no prefix (e.g. `KOMODO_PASSKEY`, `KOMODO_WEBHOOK_SECRET`).
- Secrets: variable name ends in `_SECRET`, `_KEY`, `_PASSWORD`, or `_TOKEN`, and `is_secret = true`.

The runtime contract for each stack is the `environment` block in its `stack.toml`. For local development, the root [`.env.example`](../../.env.example) is the single template. There is no per-stack `.env.example` because it would just duplicate the TOML and drift.

To add a new value: append the entry in `resources/variables.toml`, set `include_variables = true` once, sync, fill the value in the UI, flip `include_variables` back to `false`. See [docs/komodo.md](../../docs/komodo.md) for the full cutover detail.

## Procedures

[procedures.toml](procedures.toml) defines every Procedure:

| Procedure | What it does |
| --- | --- |
| `deploy-database-{env}` | Deploy the database stack on one environment. |
| `deploy-temporal-{env}` | Deploy the temporal stack. |
| `deploy-observability-{env}` | Deploy the observability stack. |
| `deploy-apps-{env}` | Deploy the apps stack (re-deploy only; promote-production is the normal release path for prod). |
| `deploy-infra-{env}` | Sequence: database → temporal → observability. |
| `deploy-all-{env}` | Sequence: database → temporal → observability → apps. Cold-start. |
| `restart-apps-{env}` | Restart apps containers without re-pulling images. |
| `backup-data-{env}` | Run the one-shot `postgres-backup` service. Output goes to the `backups` named volume. |
| `promote-production` | Production app deploy after the GitHub Actions digest retag. Called via webhook from `promote-production.yml`. |
| `prune-images` | Daily scheduled image prune on both staging and production. |

## Deploy paths

- **Staging apps:** GitHub Actions builds images, pushes `staging` + `sha-<commit>` tags, then calls `https://komodo.logid.xyz/listener/github/stack/reputo-apps-staging/deploy`. The stack pulls and recreates. No human in the loop.
- **Production apps:** the `Promote to Production` workflow retags `sha-<commit>` to `production` + `prod-<commit>` by digest, then calls the `promote-production` Procedure webhook.
- **Infra / temporal / observability:** these never deploy from CI. Trigger from the Komodo UI via the matching `deploy-*` Procedure or directly on the stack.
- **Backups:** trigger `backup-data-{env}` from the Komodo UI, or schedule it later by setting `schedule` / `schedule_enabled` on the procedure.

## Host prerequisites (per Periphery host)

1. Docker Engine + Compose plugin.
2. A reachable private IP for the Komodo Core → Periphery connection.
3. Run [periphery/install.sh](periphery/install.sh) (idempotent). The script creates the shared bridge network named `reputo` if it does not exist.
4. Create the writable host paths the stacks expect:
   - `TRAEFIK_CERTS_PATH` (default `/var/lib/reputo/traefik/certs`) — owned by the traefik container UID and `chmod 600` for the ACME store.
5. Make sure the `reputo-org/reputo` GHCR PAT is configured in Komodo under `Settings > Providers` if the registry needs auth.

## Adding a service

Decide which stack it belongs to by lifecycle:

- **Stateful, rarely-changing** → `database` or `temporal` (or a new stack if it is independent).
- **Long-lived agent for metrics/logs** → `observability`.
- **Stateless, deploys with the apps** → `apps`.

Then:

1. Add the service to the chosen `stacks/<name>/compose.yml`.
2. Add any new env vars to the stack's `environment` block in `stacks/<name>/stack.toml` and (for new secrets) [resources/variables.toml](resources/variables.toml). Also add them to the root [`.env.example`](../../.env.example) so local dev knows about them.
3. Merge, sync `reputo-main`, deploy the affected stack.

## Related docs

- [docs/komodo.md](../../docs/komodo.md) — Komodo Core install, RBAC, webhooks, backups.
- [docs/deployment.md](../../docs/deployment.md) — release channels and rollback.
- [docs/environment-variables.md](../../docs/environment-variables.md) — rules for adding a variable.
- [MIGRATION.md](MIGRATION.md) — how to cut over from the old `komodo/` layout to this one.
- [ROLLBACK.md](ROLLBACK.md) — how to revert if the cutover goes wrong.
