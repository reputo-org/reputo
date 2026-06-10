# Deployment

Reputo deploys to staging and production through Komodo. Image builds run in GitHub Actions; the deploy step talks to the Komodo API: it pins the stack's image tag variable to one immutable `sha-<commit>` tag, triggers `DeployStack`, waits for Komodo to report success, and then verifies that `GET /api/v1/health` serves the expected commit.

## Channels

| Channel | Deployed tag | Where it deploys | How it gets there |
| --- | --- | --- | --- |
| Preview | `sha-<commit>` | Per-PR HTTPS preview on a Lightsail VM (PullPreview) | `pullpreview` label on a PR |
| Staging | `sha-<commit>` via `STAGING_IMAGE_TAG` | `reputo-apps-staging` Komodo stack | every push to `main` |
| Production | `sha-<commit>` via `PRODUCTION_IMAGE_TAG` | `reputo-apps-production` Komodo stack | manual `Promote to Production` workflow |

Both environments deploy the **same** immutable images that were built once on `main`. The `production` and `prod-<commit>` tags are aliases for humans and audit only.

## Staging deploy (automatic)

1. A merge to `main` runs the `main` workflow.
2. The quality gate runs lint, typecheck, tests, build, and a migration check in parallel.
3. `_build-and-push.yml` builds Docker images for **all** apps, publishes the immutable `sha-<commit>` tags, and scans them with Trivy.
4. The deploy job sets the Komodo Variable `STAGING_IMAGE_TAG` to `sha-<commit>` and triggers `DeployStack reputo-apps-staging` through the Komodo API.
5. The job waits for the Komodo update to complete, then polls `https://staging.logid.xyz/api/v1/health` until the API reports the deployed commit SHA.
6. The staging URL is <https://staging.logid.xyz>.

## Production promotion (manual)

1. Open GitHub Actions and run `Promote to Production`.
2. Enter a commit SHA or a release tag (for example `v1.4.2`).
3. The workflow requires the commit to be **on `main`** (preview builds publish images for unmerged PR code too, so image existence alone is not proof of review) and to have a **complete** image set — production is always the whole stack at one commit.
4. It tags the `production` and `prod-<commit>` aliases, sets `PRODUCTION_IMAGE_TAG` to `sha-<commit>`, and triggers `DeployStack reputo-apps-production` via the Komodo API.
5. The job waits for Komodo, then polls `https://logid.xyz/api/v1/health` until the deployed commit is serving.
6. The production URL is <https://logid.xyz>.

## Rollback

Rolling back is the same operation as deploying, with an older commit:

- **Production**: run `Promote to Production` with the previous known-good commit SHA or release tag. The workflow re-pins `PRODUCTION_IMAGE_TAG` and redeploys that exact image set.
- **Staging**: revert the commit on `main` (preferred), or set `STAGING_IMAGE_TAG` back to the previous `sha-<commit>` in Komodo (Settings > Variables) and run `Stacks > reputo-apps-staging > Deploy`.

Database migrations run in the API container entrypoint before the API starts, so a rollback to an image that predates an applied migration is only safe when the migration is backward compatible. Write migrations expand-then-contract: first ship a migration that adds the new schema while the old code still works, and only remove the old schema after the code that needs it is gone. The quality gate checks every migration's `down()` by applying, reverting, and re-applying against a fresh Postgres.

## One-time Komodo setup

The pipelines need three things in Komodo (see [komodo.md](komodo.md) for the platform itself):

1. **API key** — create one in Komodo under Settings > API Keys, and store it as the `KOMODO_API_KEY` / `KOMODO_API_SECRET` secrets in the GitHub `staging` and `production` environments (or as repository secrets).
2. **Variables** — `STAGING_IMAGE_TAG` and `PRODUCTION_IMAGE_TAG` are declared in [`variables.toml`](../infra/komodo/resources/variables.toml). Follow the bootstrap flow documented there (flip `include_variables` on, sync, set an initial `sha-<commit>` value, flip it back off).
3. **Resource sync** — run the `reputo-main` sync once so the stacks pick up `IMAGE_TAG=[[STAGING_IMAGE_TAG]]` / `[[PRODUCTION_IMAGE_TAG]]` and the disabled stack webhooks.

## Configuration

- Komodo Variables are the single source of truth for staging and production. They are declared in [`infra/komodo/resources/variables.toml`](../infra/komodo/resources/variables.toml) and resolved through `[[NAME]]` references in each stack's [`stack.toml`](../infra/komodo/stacks/).
- The deploy Compose files under [`infra/komodo/stacks/`](../infra/komodo/stacks/) have no `env_file:` directives. Every value flows through `${VAR}` interpolation from the Komodo-generated `.komodo-reputo-*.env` file.
- Service selection is by stack membership — each of the four stacks ships its own compose file rather than sharing one filtered by `COMPOSE_PROFILES`.

See [Environment variables](environment-variables.md) for the rules on adding or changing a variable.
