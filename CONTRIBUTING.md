# Contributing

Thanks for your interest in Reputo. This guide covers how to propose a change.

## Before you start

- For setup, see [Local development](docs/local-development.md).
- For algorithms, see [Reputation algorithms](docs/reputation-algorithms.md).

## Branching

Reputo uses [GitHub Flow](https://docs.github.com/get-started/quickstart/github-flow).

1. Create a feature branch from `main`:

    ```bash
    git checkout -b feature/your-feature-name
    ```

2. Push your branch and open a pull request to `main`.
3. Add the `pullpreview` label if you want a per-PR preview environment.
4. Make sure the quality gate is green, then request a review.

## Commits

Commits must follow [Conventional Commits](https://www.conventionalcommits.org). The `commit-msg` Git hook runs [Commitlint](https://commitlint.js.org) and rejects messages that do not match.

Use the guided helper if unsure:

```bash
pnpm cz
```

## Git hooks

[`lefthook`](https://github.com/evilmartians/lefthook) is installed by `pnpm install` (`postinstall`). It runs:

- `commit-msg` — `commitlint` validates the final message.
- `pre-commit` — `pnpm check` (Biome lint and format).
- `pre-push` — `pnpm check` and `pnpm test`.

## Pull requests

- Keep diffs focused and PR-sized.
- Reference any related issue.
- Describe the change and the motivation in the PR body.
- The quality gate (lint, tests, build) must pass.
- A reviewer must approve before merge.