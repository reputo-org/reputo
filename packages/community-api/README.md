# @reputo/community-api

Read-only TypeScript clients for the community platforms Reputo scores. The
package owns the platform HTTP details — retries, rate limits, payload shapes —
and hands back small, platform-neutral values.

Today it ships the **Discord** client and adapter:

- `buildInstallUrl` — bot-install authorization URL (`scope=bot`, permissions
  limited to View Channels and Read Message History).
- `exchangeCode` — exchanges the callback code and returns the installed guild.
- `listResources` — text, announcement, and forum channels of a guild.
- `probe` — lists channels and reads one page of history to verify the granted
  permissions, keeping counts only.
- `createDiscordAdapter` — the read side alone (bot token only). Besides
  `listResources` and `probe` it adds `iterateRecords`, which streams one
  channel's window — messages, active and public archived threads, forum
  posts — as canonical, content-free activity records with a resume cursor
  per page batch.

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

## Errors

Every failure arrives as a typed error carrying a safe `category`:

| Error | Category | Typical cause |
| --- | --- | --- |
| `CommunityAuthError` | `auth_failed` | Revoked bot, rejected authorization code |
| `CommunityPermissionError` | `permission_denied` | Missing View Channels or Read Message History |
| `CommunityRateLimitError` | `rate_limited` | 429s outlasted the retry budget |
| `CommunityNetworkError` | `network_error` | Timeout, refused connection |
| `CommunityHttpError` | `upstream_error` / `not_found` | Other non-2xx responses |
| `CommunityContractError` | `contract_violation` | Response missing a documented field |

Persist the category, never the message body.

## Privacy

No message text, titles, or bodies are read or returned — only ids, counts, and
whether the fields a later fetch depends on were present. Secrets are arguments
only: they are never persisted and never logged.

## Scripts

```bash
pnpm --filter @reputo/community-api build
pnpm --filter @reputo/community-api test
pnpm --filter @reputo/community-api docs
```
