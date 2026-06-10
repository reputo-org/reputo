# CI/CD

GitHub Actions runs the quality gate on every pull request and the full build-test-deploy pipeline on every push to `main`. All workflows live under [`.github/workflows/`](../.github/workflows/).

Three rules shape the pipeline:

- **Build once, deploy everywhere.** Every push to `main` builds all three apps and publishes immutable `sha-<commit>` images. Staging and production deploy those exact images; production never rebuilds.
- **Deploys are pinned and verified.** A deploy sets a Komodo Variable (`STAGING_IMAGE_TAG` / `PRODUCTION_IMAGE_TAG`) to one `sha-<commit>` tag, triggers `DeployStack` through the Komodo API, waits for Komodo to finish, and then polls `GET /api/v1/health` until the running commit matches.
- **Deploy runs queue, they are never cancelled.** PR runs cancel outdated attempts, but `main` runs and production promotions each use their own no-cancel concurrency group.

## Workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [`pull-request.yml`](../.github/workflows/pull-request.yml) | PR opened, updated, or reopened against `main` | Quality gate plus a no-push Docker build for affected apps. |
| [`pull-preview.yml`](../.github/workflows/pull-preview.yml) | PR labelled `pullpreview`, plus an hourly cleanup schedule | Builds preview images and deploys a per-PR HTTPS preview on a Lightsail VM via PullPreview. |
| [`main.yml`](../.github/workflows/main.yml) | Push to `main` | Quality gate, build and push **all** apps (`sha-<commit>`), Trivy scan, semantic-release, version-tag the images, deploy staging via the Komodo API, verify the deployed commit. |
| [`release.yml`](../.github/workflows/release.yml) | Called by `main.yml` | Runs `semantic-release` and outputs the released tag (for image version tags). |
| [`promote-production.yml`](../.github/workflows/promote-production.yml) | Manual `workflow_dispatch` | Takes a commit SHA **or release tag**, requires the commit to be on `main` and to have a complete image set, retags `production` / `prod-<commit>` aliases, then deploys via `_deploy.yml`. |
| [`_quality-gate.yml`](../.github/workflows/_quality-gate.yml) | Called by other workflows | Reusable, parallel jobs: workflow lint (actionlint, plus advisory zizmor), lint + typecheck, tests with coverage (Codecov), build, and a database migration check (apply, revert, re-apply against a fresh Postgres). |
| [`_build-and-push.yml`](../.github/workflows/_build-and-push.yml) | Called by other workflows | Reusable: derive the app set from `apps/*/Dockerfile`, compute affected apps via Turbo, build per-app images (with SBOM and provenance attestations), optionally push to GHCR, scan pushed images with Trivy. |
| [`_deploy.yml`](../.github/workflows/_deploy.yml) | Called by `main.yml` and `promote-production.yml` | Reusable, one deploy path for both environments: pin the Komodo `*_IMAGE_TAG` Variable to `sha-<commit>`, `DeployStack`, wait for the update, verify `/api/v1/health` serves the commit. |

Two pieces keep the workflows small:

- [`.github/actions/setup`](../.github/actions/setup/action.yml) — composite action used by every job: installs pnpm (version from the root `package.json` `packageManager` field), Node.js (version read from [`mise.toml`](../mise.toml), the single source of truth — the Docker images use the same value through the `NODE_VERSION` build arg), restores the Turbo cache (`actions/cache`, no paid remote cache), and runs `pnpm install`.
- [`.github/scripts/`](../.github/scripts/) — `komodo-deploy.sh` (pin variable, deploy stack, wait for the Komodo update) and `verify-deploy.sh` (poll `/api/v1/health` until the expected commit is serving).

## Versions and tags

| Tag | Created by | Meaning |
| --- | --- | --- |
| `sha-<commit>` | every `main` push | Immutable build of that commit. The only tag stacks deploy. |
| `vX.Y.Z` | `main.yml` after semantic-release | Alias for the `sha-<commit>` of the released commit. |
| `prod-<commit>`, `production` | `promote-production.yml` | Aliases recording what was promoted; not used for deploys. |

Previews have no tag of their own: `pull-preview.yml` builds and deploys the same immutable `sha-<commit>` images as every other channel.

## Supply chain

- All actions are pinned to commit SHAs; [Dependabot](../.github/dependabot.yml) updates the pins (and npm dependencies, including the pnpm catalog) weekly.
- Every workflow grants the minimum `GITHUB_TOKEN` permissions at the workflow level; jobs that push images or create releases raise their own scope.
- Pushed images get SBOM and provenance attestations and a Trivy scan (gate on `CRITICAL`, unfixed CVEs ignored).

## Secrets

In the GitHub `staging` and `production` environments (or as repository secrets):

- `KOMODO_API_KEY` / `KOMODO_API_SECRET` — Komodo API key used to pin image tags and trigger deploys. Create it in Komodo under Settings > API Keys.

Repository secrets used by the build:

- `CODECOV_TOKEN` — coverage upload.
- `GITHUB_TOKEN` — provided by GitHub Actions.

Secrets used by `pull-preview.yml`:

- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — provision the Lightsail preview VM (region `eu-central-1`).
- `DEEPFUNDING_API_KEY`, `ALCHEMY_API_KEY`, `BLOCKFROST_API_KEY` — passed into the preview so the workers can run snapshots end to end.

`KOMODO_WEBHOOK_SECRET` is no longer used by the pipelines (deploys go through the Komodo API); it is still needed by Komodo Core itself.
