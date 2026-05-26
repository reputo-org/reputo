# Deployment

Reputo deploys to staging and production through Komodo. Image builds and tag promotion run in GitHub Actions. The deploy step is a webhook to Komodo, which pulls the new images and runs `docker compose up -d` on the target host.



## Channels

| Channel | Image tag | Where it deploys | How it gets there |
| --- | --- | --- | --- |
| Preview | `preview-<commit>` | PullPreview Lightsail VM per PR | `pullpreview` label on a PR |
| Staging | `staging` (mutable) and `sha-<commit>` (immutable) | `reputo-apps-staging` Komodo stack | every push to `main` |
| Production | `production` (mutable) and `prod-<commit>` (immutable) | `reputo-apps-production` Komodo stack | manual `Promote to Production` workflow |

## Staging deploy (automatic)

1. A merge to `main` runs the `main` workflow.
2. The quality gate runs lint, tests, and a full build.
3. `_build-and-push.yml` builds Docker images for the **affected** apps only. It publishes the immutable `sha-<commit>` tag and updates the mutable `staging` tag.
4. The workflow calls the Komodo staging Stack webhook.
5. Komodo pulls the new images and runs `docker compose pull && up -d` on `reputo-apps-staging`.
6. The staging URL is <https://staging.logid.xyz>.

## Production promotion (manual)

1. Open GitHub Actions and run `Promote to Production`.
2. Enter the commit SHA whose `sha-<commit>` images you want to promote.
3. The workflow finds the available app images and retags their digests to `production` and `prod-<commit>`.
4. The workflow calls the `promote-production` Komodo Procedure webhook.
5. Komodo deploys `reputo-apps-production` with `IMAGE_TAG=production`.
6. The production URL is <https://logid.xyz>.


## Rollback

### Staging

1. Find the previous known-good commit SHA.
2. Retag the affected app images from `sha-<commit>` back to `staging` in GHCR.
3. Run `Stacks > reputo-apps-staging > Deploy` in Komodo.
4. Check staging health and stack events.

### Production

1. Find the previous known-good commit SHA.
2. Run the `Promote to Production` workflow with that SHA.
3. Check that the workflow retagged the affected images and called Komodo.
4. Check the `promote-production` Procedure run and the production stack.


## Configuration

- Komodo Variables are the single source of truth for staging and production. They are declared in [`infra/komodo/resources/variables.toml`](../infra/komodo/resources/variables.toml) and resolved through `[[NAME]]` references in [`infra/komodo/resources/stacks.toml`](../infra/komodo/resources/stacks.toml).
- The deploy Compose files under [`infra/komodo/compose/`](../infra/komodo/compose/) have no `env_file:` directives. Every value flows through `${VAR}` interpolation from the Komodo-generated `.komodo-reputo-*.env` file.
- Service selection is by stack membership — each of the four stacks ships its own compose file rather than sharing one filtered by `COMPOSE_PROFILES`.

See [Environment variables](environment-variables.md) for the rules on adding or changing a variable.
