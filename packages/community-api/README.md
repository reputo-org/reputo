# @reputo/community-api

Read-only TypeScript clients and adapters for Discord, GitHub, and Mattermost. The package owns the platform HTTP details (retries, rate limits, payload shapes) and returns small, platform-neutral values. It reads no environment variables and touches no database.

## Main exports

Per platform, a **client** for the connect flow and an **adapter** for the read side (`CommunityAdapter` in `src/shared/records.ts`: `listResources`, `probe`, `iterateRecords`, `searchMemberId`, optional `searchMemberIds`).

| Platform | Client | Adapter |
| --- | --- | --- |
| Discord | `buildInstallUrl`, `exchangeCode`, `listResources` (channels with read verdicts from the bot's effective permissions), `probe`, `leaveGuild` | `createDiscordAdapter`: messages, threads, and forum posts as content-free records; member search by exact username. |
| GitHub | `buildInstallUrl`, `confirmInstallation`, `listResources` (repositories by numeric id, issues-off ones marked unreadable), `probe`, `deleteInstallation` | `createGitHubAdapter`: pull requests opened and merged, reviews, issues, comments; user lookup by login. |
| Mattermost | `createMattermostClient`: `validateToken`, `listResources`, `probe` | `createMattermostAdapter`: posts, replies, and reactions from a keyset crawl (`before` cursor, never `since`); bulk username lookup. |

Shared pieces:

- `executeSafeRequest` (`src/shared/safe-fetch.ts`): the outbound policy for admin-supplied URLs. Resolves once, pins the address, blocks private targets, refuses redirects, requires HTTPS unless the host is allow-listed, caps the response size.
- `sealCommunityCredential` and `openCommunityCredential` (`src/shared/credentials.ts`): AES-256-GCM envelopes with a key id, so the key can rotate.
- Live-feed sources (`src/shared/realtime.ts`, `src/discord/gateway.ts`, `src/github/webhooks.ts`, `src/mattermost/socket.ts`): platform events mapped to `CommunitySignal`s.

## Usage

```ts
import { createDiscordClient, DEFAULT_HTTP_CONFIG } from '@reputo/community-api';

const discord = createDiscordClient(
  { ...DEFAULT_HTTP_CONFIG, clientId, clientSecret, botToken, callbackUrl },
  logger,
);

const url = discord.buildInstallUrl(signedState);
const guild = await discord.exchangeCode(code);
const probe = await discord.probe(guild.id);
```

## Errors

Every failure is a typed error with a safe `category`. Persist the category, never the message body.

| Error | Category | Typical cause |
| --- | --- | --- |
| `CommunityAuthError` | `auth_failed` | Revoked bot or token, rejected authorization code |
| `CommunityPermissionError` | `permission_denied` | Missing read permissions, no readable resource |
| `CommunityRateLimitError` | `rate_limited` | Throttles outlasted the retry budget |
| `CommunityNetworkError` | `network_error` | Timeout, refused connection |
| `CommunityHttpError` | `upstream_error`, `not_found` | Other non-2xx responses |
| `CommunityContractError` | `contract_violation` | Response missing a documented field |
| `CommunityOutboundPolicyError` | `outbound_policy` | A URL the safe fetch refuses |

## Privacy

No message text, titles, or bodies are read or returned. Only ids, timestamps, and counts. Secrets are arguments only and are never persisted or logged.

## Commands

```bash
pnpm --filter @reputo/community-api build
pnpm --filter @reputo/community-api test
pnpm --filter @reputo/community-api docs
```

## Related documentation

- [Community connections](../../docs/community-connections.md)
- [Community algorithms](../../docs/community-algorithms.md)
- [Adding a community platform](../../docs/adding-a-community-platform.md)
