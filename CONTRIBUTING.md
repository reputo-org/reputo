# Contributing

Thanks for your interest in Reputo. This guide covers how to propose a change.

## Before you start

- Read the root [`AGENTS.md`](AGENTS.md). It lists workspace rules and the env-var contract.
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

Common types:

- `feat:` — new feature (minor version bump on release).
- `fix:` — bug fix (patch version bump).
- `feat!:` or a `BREAKING CHANGE:` footer — breaking change (major version bump).
- `chore:`, `docs:`, `test:`, `refactor:`, `ci:`, `style:`, `build:`, `perf:` — no version bump.

## Git hooks

[`lefthook`](https://github.com/evilmartians/lefthook) is installed by `pnpm install` (`postinstall`). It runs:

- `prepare-commit-msg` — opens [Commitizen](https://commitizen-tools.github.io/commitizen/) when you run `git commit` without `-m`.
- `commit-msg` — `commitlint` validates the final message.
- `pre-commit` — `pnpm check` (Biome lint and format).
- `pre-push` — `pnpm check` and `pnpm test`.

If a hook fails, fix the underlying issue. Do not bypass it.

## Workspace rules

These come from [`AGENTS.md`](AGENTS.md):

- `packages/` must never import from `apps/`.
- `apps/` may depend on `packages/`, but not on sibling apps.
- Always import from a package's public entry (`src/index.ts`).
- Keep explicit types on every public export.
- When behaviour changes, update or add tests in the same PR.
- TypeORM is the standard ORM for `@reputo/api`, `@reputo/onchain-data`, and `@reputo/deepfunding-portal-api`.

## Environment variables

A new environment variable lands in one PR that updates:

1. The relevant app's Zod schema.
2. The root [`.env.example`](.env.example).
3. The `environment:` block in both `docker/compose/compose.dev.yml` and `docker/compose/compose.yml`.
4. `komodo/resources/variables.toml` and the matching stack `environment` block.

See [Environment variables](docs/environment-variables.md) for the full procedure and the secret rules.

## Code style

- TypeScript with strict types.
- Biome handles lint and format. Run `pnpm check` before pushing.
- Indent: 2 spaces. Line length: 120. Single quotes. Trailing commas on every multiline list.
- Write code that is self-explanatory. Avoid file-level headers, section dividers, and `// ===== Foo =====` banners. See the "Comments" section in [`AGENTS.md`](AGENTS.md) for the full policy.

## Pull requests

- Keep diffs focused and PR-sized.
- Reference any related issue.
- Describe the change and the motivation in the PR body.
- The quality gate (lint, tests, build) must pass.
- A reviewer must approve before merge.

## See also

- [`AGENTS.md`](AGENTS.md)
- [Documentation index](docs/README.md)
