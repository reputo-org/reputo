# Deployment

How staging and production get a new version. Images are built once in GitHub Actions. A deploy pins the stack's image tag variable to one immutable `sha-<commit>` tag, triggers `DeployStack` through the Komodo API, waits for Komodo, and checks that `GET /api/v1/health` serves that commit.

## Channels

| Channel | Where | How |
| --- | --- | --- |
| Preview | Per-PR HTTPS preview on a Lightsail VM (PullPreview) | Add the `pullpreview` label to a PR. |
| Staging | `reputo-apps-staging` stack, <https://staging.logid.xyz> | Every push to `main`. |
| Production | `reputo-apps-production` stack, <https://logid.xyz> | The manual `Promote to Production` workflow. |

Staging and production deploy the same images. The `production` and `prod-<commit>` tags are aliases for people and audit only.

## Staging deploy (automatic)

1. A merge to `main` runs the `main` workflow.
2. The quality gate runs lint, typecheck, tests, build, and a migration check.
3. The build job publishes `sha-<commit>` images for all apps and scans them with Trivy.
4. The deploy job sets `STAGING_IMAGE_TAG` to `sha-<commit>` and triggers `DeployStack reputo-apps-staging`.
5. The job waits for Komodo, then polls `/api/v1/health` until the API reports the commit.

## Production promotion (manual)

1. In GitHub Actions, run `Promote to Production`.
2. Enter a commit SHA or a release tag such as `v1.4.2`.
3. The workflow checks that the commit is on `main` and has a complete image set.
4. It tags the `production` and `prod-<commit>` aliases, sets `PRODUCTION_IMAGE_TAG`, and triggers `DeployStack reputo-apps-production`.
5. The job waits for Komodo, then polls `/api/v1/health`.

## Rollback

A rollback is a deploy of an older commit.

- Production: run `Promote to Production` with the previous good commit or tag.
- Staging: revert the commit on `main`, or set `STAGING_IMAGE_TAG` back to the previous tag in Komodo (Settings > Variables) and run `Stacks > reputo-apps-staging > Deploy`.

Migrations run in the API container before the API starts. A rollback to an image older than an applied migration is only safe when the migration is backward compatible. Write migrations expand-then-contract: add the new schema first, remove the old schema only after the code that needs it is gone.

## One-time Komodo setup

1. **API key.** Create one under Settings > API Keys. Store it as `KOMODO_API_KEY` and `KOMODO_API_SECRET` in the GitHub `staging` and `production` environments.
2. **Variables.** `STAGING_IMAGE_TAG` and `PRODUCTION_IMAGE_TAG` are declared in [`variables.toml`](../infra/komodo/resources/variables.toml). Follow the bootstrap steps in that file.
3. **Resource sync.** Run the `reputo-main` sync once so the stacks pick up the image tag variables.

See [Komodo operations](komodo.md) for the platform itself.

## Configuration

- Komodo variables are the source of truth for staging and production. They are declared in [`variables.toml`](../infra/komodo/resources/variables.toml) and referenced as `[[NAME]]` in each stack's `stack.toml`.
- The deploy Compose files have no `env_file`. Every value flows through `${VAR}` from the Komodo-generated env file.
- Each stack has its own Compose file under [`infra/komodo/stacks/`](../infra/komodo/stacks/).

Rules for adding a variable are in [Environment variables](environment-variables.md). The community platform variables, including the required `GITHUB_APP_WEBHOOK_SECRET` and the Mattermost sealing key, are explained in [Community platform setup](community-platform-setup.md).
