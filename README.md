# Reputo

[Reputo](https://logid.xyz) is a modular, privacy-preserving reputation platform.

<div align="center">

[![Main](https://github.com/reputo-org/reputo/actions/workflows/main.yml/badge.svg)](https://github.com/reputo-org/reputo/actions/workflows/main.yml)&nbsp;[![codecov](https://codecov.io/gh/reputo-org/reputo/branch/main/graph/badge.svg?token=K2J22EG5Y4)](https://codecov.io/gh/reputo-org/reputo)&nbsp;[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)&nbsp;[![Status: Staging](https://img.shields.io/badge/status-staging-yellow.svg)](https://staging.logid.xyz)

</div>

## Quick start

Install [mise](https://mise.jdx.dev), then run:

```bash
mise trust
mise run setup
```

Add the required secrets to `.env`, then start the stack:

```bash
pnpm docker:up
```

Open <http://localhost:4000>.

See [Local development](docs/local-development.md) for setup options, endpoints, and common commands.

## Project guide

- [Documentation](docs/README.md)
- [Monorepo structure](docs/monorepo-structure.md)
- [Contributing](CONTRIBUTING.md)
- [Staging app](https://staging.logid.xyz) and [API reference](https://api-staging.logid.xyz/reference)

## License

Released under the **GPL-3.0** license. See [LICENSE](LICENSE).
