# CI/CD

GitHub Actions runs the quality gate on every pull request and the build, test, and deploy pipeline on every push to `main`. Workflows live under [`.github/workflows/`](../.github/workflows/).

Three rules shape the pipeline:

- **Build once, deploy everywhere.** Every push to `main` builds all apps and publishes immutable `sha-<commit>` images. Staging and production deploy those images. Production never rebuilds.
- **Deploys are pinned and verified.** A deploy sets a Komodo variable to one `sha-<commit>` tag, triggers `DeployStack`, waits, then polls `GET /api/v1/health` until the running commit matches.
- **Deploy runs queue.** PR runs cancel outdated attempts. `main` runs and production promotions never cancel.

## Workflows

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [`pull-request.yml`](../.github/workflows/pull-request.yml) | PR against `main` | Quality gate, dependency review, Docker builds. With the `pullpreview` label it also publishes images and redeploys the preview. |
| [`pull-preview.yml`](../.github/workflows/pull-preview.yml) | The `pullpreview` label is added or removed, or a labelled PR closes | Creates or destroys the per-PR Lightsail preview. |
| [`_pull-preview.yml`](../.github/workflows/_pull-preview.yml) | Called by the two above | Reusable PullPreview deploy or destroy job. |
| [`main.yml`](../.github/workflows/main.yml) | Push to `main` | Quality gate, build and push all apps, Trivy scan, semantic-release, version tags, staging deploy, verification. |
| [`_release.yml`](../.github/workflows/_release.yml) | Called by `main.yml` | Runs `semantic-release` and outputs the released tag. |
| [`promote-production.yml`](../.github/workflows/promote-production.yml) | Manual | Takes a commit SHA or release tag, checks it is on `main` with a complete image set, retags the aliases, deploys production. |
| [`_quality-gate.yml`](../.github/workflows/_quality-gate.yml) | Called by other workflows | Parallel jobs: workflow lint, lint and typecheck, tests with coverage, build, migration check (apply, revert, re-apply). |
| [`_build-and-push.yml`](../.github/workflows/_build-and-push.yml) | Called by other workflows | Builds per-app images with SBOM and provenance, pushes to GHCR, scans with Trivy. |
| [`_deploy.yml`](../.github/workflows/_deploy.yml) | Called by `main.yml` and `promote-production.yml` | Pins the `*_IMAGE_TAG` variable, deploys the stack, waits, verifies the health endpoint. |

Shared pieces:

- [`.github/actions/setup`](../.github/actions/setup/action.yml) installs pnpm and Node (versions from `package.json` and [`mise.toml`](../mise.toml)) and runs `pnpm install`. The pnpm store is cached. The Turbo cache is **not** cached across runs on purpose: pnpm injects workspace packages, and a Turbo cache hit restores `dist/` without refreshing the injected copy, which breaks dependents with `TS2307`. Do not add a cross-run Turbo cache.
- [`.github/scripts/`](../.github/scripts/) holds `komodo-deploy.sh` and `verify-deploy.sh`.

## Tags

| Tag | Created by | Meaning |
| --- | --- | --- |
| `sha-<commit>` | every `main` push | Immutable build of that commit. The only tag stacks deploy. |
| `vX.Y.Z` | `main.yml` after semantic-release | Alias of the released commit. |
| `prod-<commit>`, `production` | `promote-production.yml` | Audit aliases of what was promoted. |

## Supply chain

- Actions are pinned to commit SHAs. Dependabot updates the pins and npm dependencies weekly.
- `dependency-review-action` fails a PR that adds a dependency with a known high or critical vulnerability. It looks at the diff only.
- `pnpm audit` needs pnpm 11 or later.
- Workflows grant the minimum `GITHUB_TOKEN` permissions. Pushed images get SBOM and provenance attestations and a Trivy scan.

## Secrets

| Secret | Where | Used for |
| --- | --- | --- |
| `KOMODO_API_KEY`, `KOMODO_API_SECRET` | GitHub `staging` and `production` environments | Pin image tags and trigger deploys. |
| `CODECOV_TOKEN` | Repository | Coverage upload. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Repository | The Lightsail preview VM (`eu-central-1`). |
| `DEEPFUNDING_API_KEY`, `ALCHEMY_API_KEY`, `BLOCKFROST_API_KEY`, `DEEP_ID_CLIENT_ID`, `DEEP_ID_CLIENT_SECRET` | Repository | Let the preview run snapshots end to end. |

The quality gate gives the migration job placeholder values for the Discord, GitHub, and community variables. They are not real credentials.
