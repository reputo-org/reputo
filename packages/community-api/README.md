# @reputo/community-api

Read-only TypeScript clients for the community platforms Reputo scores. The
package owns the platform HTTP details — retries, rate limits, payload shapes —
and hands back small, platform-neutral values.

Today it ships the **Discord** and **GitHub** clients and adapters.

## Discord

- `buildInstallUrl` — bot-install authorization URL (`scope=bot`, permissions
  limited to View Channels and Read Message History).
- `exchangeCode` — exchanges the callback code and returns the installed guild.
- `listResources` — text, announcement, and forum channels of a guild, each
  marked readable or not from the bot's effective permissions (guild roles
  plus channel overwrites), so a private channel is never offered as readable.
- `probe` — lists channels and reads one page of history from a readable one
  to verify the granted permissions, keeping counts only.
- `createDiscordAdapter` — the read side alone (bot token only). Besides
  `listResources` and `probe` it adds `iterateRecords`, which streams one
  channel's window — messages, active and public archived threads, forum
  posts — as canonical, content-free activity records with a resume cursor
  per page batch.

## GitHub

- `buildInstallUrl` — GitHub App install URL. GitHub redirects to the App's
  configured setup URL, so the callback URL is App configuration.
- `confirmInstallation` — confirms a callback's `installation_id` with the app
  JWT and returns the account it belongs to.
- `listResources` — repositories the installation can read, keyed by their
  stable numeric id so a rename cannot invalidate a saved preset. A repository
  with its issue tracker off is listed as unreadable.
- `probe` — confirms the installation (not uninstalled, not suspended, still
  granting issues, pull requests, and metadata), lists repositories, and reads
  one issues page to verify the App's permissions.
- `deleteInstallation` — uninstalls the App; already-gone installations succeed.
- `createGitHubAdapter` — the read side alone, bound to one installation.
  `iterateRecords` streams a repository's window as canonical, content-free
  records: pull requests opened and merged (credited to the author), reviews,
  issues, and both issue and review comments. The app JWT mints installation
  tokens per run; neither is persisted.

The package reads no environment variables and touches no database; the
consuming app validates its env and passes the values in.

## Usage

```ts
import { createDiscordClient, DEFAULT_HTTP_CONFIG } from '@reputo/community-api';

const discord = createDiscordClient(
  {
    ...DEFAULT_HTTP_CONFIG,
    clientId: env.DISCORD_CLIENT_ID,
    clientSecret: env.DISCORD_CLIENT_SECRET,
    botToken: env.DISCORD_BOT_TOKEN,
    callbackUrl: env.DISCORD_BOT_CALLBACK_URL,
  },
  logger,
);

const url = discord.buildInstallUrl(signedState);
const guild = await discord.exchangeCode(code);
const channels = await discord.listResources(guild.id);
const probe = await discord.probe(guild.id);
```

```ts
import { createGitHubClient, DEFAULT_HTTP_CONFIG } from '@reputo/community-api';

const github = createGitHubClient(
  {
    ...DEFAULT_HTTP_CONFIG,
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    slug: env.GITHUB_APP_SLUG,
    callbackUrl: env.GITHUB_APP_CALLBACK_URL,
  },
  logger,
);

const url = github.buildInstallUrl(signedState);
const installation = await github.confirmInstallation(installationId);
const repositories = await github.listResources(installation.id);
```

## Errors

Every failure arrives as a typed error carrying a safe `category`:

| Error | Category | Typical cause |
| --- | --- | --- |
| `CommunityAuthError` | `auth_failed` | Revoked bot, rejected authorization code |
| `CommunityPermissionError` | `permission_denied` | Missing Discord read permissions, unreadable repository |
| `CommunityRateLimitError` | `rate_limited` | Throttles outlasted the retry budget, spent GitHub hourly budget |
| `CommunityNetworkError` | `network_error` | Timeout, refused connection |
| `CommunityHttpError` | `upstream_error` / `not_found` | Other non-2xx responses |
| `CommunityContractError` | `contract_violation` | Response missing a documented field |

Persist the category, never the message body.

## Privacy

No message text, issue or pull request titles, or bodies are read or returned —
only ids, counts, and whether the fields a later fetch depends on were present.
Secrets are arguments only: they are never persisted and never logged.

## Scripts

```bash
pnpm --filter @reputo/community-api build
pnpm --filter @reputo/community-api test
pnpm --filter @reputo/community-api docs
```
