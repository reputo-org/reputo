![Reputo](.github/assets/banner.png "Reputo")

<p align="center">
  <a href="https://logid.xyz">Reputo</a> is a privacy-preserving reputation platform with three main surfaces: a NestJS API, a Next.js UI, and Temporal-based workers that orchestrate snapshot execution and algorithm runs.
  <br/>
  This repository is the pnpm monorepo for those apps and the shared packages they build on.
</p>

<div align="center">

[![CI](https://github.com/reputo-org/reputo/actions/workflows/main.yml/badge.svg)](https://github.com/reputo-org/reputo/actions/workflows/main.yml)&nbsp;[![codecov](https://codecov.io/gh/reputo-org/reputo/branch/main/graph/badge.svg?token=K2J22EG5Y4)](https://codecov.io/gh/reputo-org/reputo)&nbsp;[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)&nbsp;[![Status: Staging](https://img.shields.io/badge/status-staging-yellow.svg)](https://staging.logid.xyz)

</div>

## Live URLs (staging)

| Surface | URL |
| --- | --- |
| App | <https://staging.logid.xyz> |
| API reference | <https://api-staging.logid.xyz/reference> |

## Quick start

1. Install [mise](https://mise.jdx.dev):

    ```bash
    brew install mise            # macOS
    curl https://mise.run | sh   # Linux / WSL
    winget install jdx.mise      # Windows
    ```

2. Bootstrap the repo:

    ```bash
    mise run setup               # installs Node + pnpm, copies .env.example -> .env, runs pnpm install
    ```

3. Open `.env` and fill in every empty value. See [Environment variables](docs/environment-variables.md).

4. Run the stack. Pick one:

    **Full Docker** — apps and infrastructure in containers:

    ```bash
    pnpm docker:up
    ```

    **Hybrid** — infrastructure in Docker, apps native for faster iteration:

    ```bash
    pnpm docker:up:infra         # start Temporal, Postgres, MinIO
    pnpm db:migrate              # apply pending migrations
    pnpm dev                     # run api, ui, workflows in watch mode
    ```

See [Local development](docs/local-development.md) for the full guide.

## Workspaces

See [Monorepo structure](docs/monorepo-structure.md) for the apps, packages, and import rules.

## Documentation

Guides live in [docs/](docs/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for branching, commits, and the PR workflow.

## License

Released under the **GPL-3.0** license. See [LICENSE](LICENSE).
