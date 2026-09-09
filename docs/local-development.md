# Local development

How to run Reputo on your machine.

## Requirements

- Docker Desktop, or Docker Engine with the Compose plugin.
- [mise](https://mise.jdx.dev), which installs the Node and pnpm versions from [`mise.toml`](../mise.toml).

If you do not use mise, install the versions listed in `mise.toml` yourself.

## First-time setup

```bash
brew install mise            # macOS
# curl https://mise.run | sh # Linux / WSL
# winget install jdx.mise    # Windows
```

Activate mise in your shell, then run:

```bash
mise trust
mise run setup
```

Open `.env` and fill in every empty value, especially `*_SECRET`, `*_KEY`, and `*_PASSWORD`. See [Environment variables](environment-variables.md).

## Run the apps

Pick one flow. Both use [`infra/dev/compose.yml`](../infra/dev/compose.yml).

**Full Docker**

```bash
pnpm docker:up               # start the apps and supporting services
pnpm docker:down
```

**Hybrid** (infrastructure in Docker, apps native, faster iteration)

```bash
pnpm docker:up:infra         # start supporting services only
pnpm db:migrate              # apply pending migrations
pnpm dev                     # api, ui, workflows in watch mode
pnpm docker:down
```

## Local endpoints

| Service | URL or command |
| --- | --- |
| UI | <http://localhost:4000> |
| API | <http://localhost:3000> |
| API reference | <http://localhost:3000/reference> |
| Temporal UI | <http://localhost:8088> |
| MinIO console | <http://localhost:9001> (login `minio` / `minio12345`) |
| Mattermost | <http://localhost:8065> |
| App Postgres | `psql postgresql://reputo_app:reputo_app@localhost:5434/reputo_app` |
| Onchain Postgres | `psql postgresql://reputo_onchain:reputo_onchain@localhost:5433/reputo_onchain` |

## Try the community flows locally

The Communities page needs platform credentials. [Community platform setup](community-platform-setup.md) explains each platform. In short:

- **Discord.** Create a development application and bot. Use `http://localhost:3000/api/v1/community/connections/discord/callback` as the OAuth redirect.
- **GitHub.** Create a development GitHub App with the Setup URL `http://localhost:3000/api/v1/community/connections/github/callback`. Webhooks need a public tunnel to reach your API.
- **Mattermost.** Open <http://localhost:8065>, create the first user, create a bot account with a token, and keep `COMMUNITY_MATTERMOST_ALLOWED_HOSTS=localhost` in `.env`.
- **DeepID.** Add client values for the same DeepID environment as the data sources.

## Common commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run all apps in watch mode. |
| `pnpm build` | Build every workspace. |
| `pnpm check` | Biome lint and format check. |
| `pnpm test` | Vitest across the repo. |
| `pnpm typecheck` | Type-check every workspace. |
| `pnpm clean` | Remove `dist/`, `.turbo/`, and caches. |
| `pnpm algorithm:create <key> <version>` | Scaffold a new algorithm. See [Reputation algorithms](reputation-algorithms.md). |
| `pnpm algorithm:validate` | Validate the algorithm registry. |
