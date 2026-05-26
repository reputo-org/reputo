# CI/CD

GitHub Actions runs the quality gate on every pull request and the full build-test-deploy pipeline on every push to `main`. All workflows live under [`.github/workflows/`](../.github/workflows/).

## Workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [`pull-request.yml`](../.github/workflows/pull-request.yml) | PR opened, updated, or reopened against `main` | Runs the quality gate and a no-push Docker build for affected apps. |
| [`pull-preview.yml`](../.github/workflows/pull-preview.yml) | PR labelled `pullpreview` | Builds preview images and deploys a Lightsail VM for the PR. |
| [`main.yml`](../.github/workflows/main.yml) | Push to `main` | Quality gate, build and push affected images with `staging` and `sha-<commit>` tags, semantic-release, then Komodo staging deploy. |
| [`release.yml`](../.github/workflows/release.yml) | Called by `main.yml` | Runs `semantic-release` to create GitHub releases. |
| [`promote-production.yml`](../.github/workflows/promote-production.yml) | Manual `workflow_dispatch` | Retags `sha-<commit>` images to `production` and `prod-<commit>`, then calls the `promote-production` Komodo Procedure. |
| [`_quality-gate.yml`](../.github/workflows/_quality-gate.yml) | Called by other workflows | Reusable: install deps, Biome check, tests with coverage, Codecov upload, build. |
| [`_build-and-push.yml`](../.github/workflows/_build-and-push.yml) | Called by other workflows | Reusable: compute affected apps via Turbo, build per-app images, optionally push to GHCR. |


## Secrets

In the GitHub `staging` and `production` environments:

- `KOMODO_WEBHOOK_SECRET` — same value as in Komodo Core.

Repository secrets used by the build:

- `CODECOV_TOKEN` — coverage upload.
- `GITHUB_TOKEN` — provided by GitHub Actions.
