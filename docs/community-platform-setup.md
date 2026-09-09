# Community platform setup

What an operator configures before admins can connect Discord, GitHub, or Mattermost. Do this once per environment. The values are Komodo variables in staging and production (`STAGING_*` and `PRODUCTION_*`) and `.env` values locally.

## Before you start

1. Ask DeepID to register the score types `discord_engagement`, `github_engagement`, and `mattermost_engagement`, and to allow the `github`, `discord`, and `mattermost` scopes for Reputo's client. Without this, publication fails and no user is matched.
2. Set `DEEP_ID_CONSENT_SCOPES` to the full list in [DeepID integration](deep-id-integration.md#scopes). Users must consent again to add the new scopes.
3. Generate the secrets below and store them in the password manager.

## Discord

1. Create an application at <https://discord.com/developers/applications> and add a bot.
2. Under OAuth2, add the redirect `{API public URL}/api/v1/community/connections/discord/callback`.
3. Copy the client id, client secret, and bot token.

The bot needs no privileged intents. Reputo asks for View Channels and Read Message History only. Nothing else to configure: the bot's Gateway connection is how Discord changes reach Reputo.

## GitHub App

1. Create an App at <https://github.com/settings/apps> (or under the organization).
2. Repository permissions: Issues, Pull requests, and Metadata, all read-only.
3. Setup URL: `{API public URL}/api/v1/community/connections/github/callback`, with "Redirect on update" on. GitHub has no redirect parameter for installs, so this must match `GITHUB_APP_CALLBACK_URL` exactly.
4. Webhook: URL `{API public URL}/api/v1/community/webhooks/github`, a secret of 16 or more characters (`openssl rand -hex 24`), and the events **Installation**, **Installation target**, and **Repository**. This is the only way GitHub changes reach Reputo.
5. Generate a private key. Paste the PEM into the variable as one line with `\n` escapes.
6. Make the App public if organizations other than the owner must install it.

## Mattermost

Admins connect Mattermost from the UI with a server URL and a bot token, so there is no platform app to create. The operator provides:

- `COMMUNITY_CREDENTIALS_ENCRYPTION_KEY`: 32 or more characters (`openssl rand -hex 32`). It seals bot tokens at rest. The API and the workers must share the same value. Each environment gets its own.
- `COMMUNITY_MATTERMOST_ALLOWED_HOSTS`: hostnames allowed to bypass the HTTPS and public-address rules. Keep it empty in production. Use `localhost` for the dev container.

Supported servers: the current Mattermost ESR and newer.

To rotate the sealing key: move the current value to `COMMUNITY_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS`, set a new current key, redeploy, and clear the previous key after every Mattermost connection has been reconnected once. Existing connections keep working during the rotation.

## Variables

| Variable | Read by | Required |
| --- | --- | --- |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | API | Yes |
| `DISCORD_BOT_TOKEN` | API, community worker | Yes |
| `DISCORD_BOT_CALLBACK_URL` | API | Yes |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` | API, community worker | Yes |
| `GITHUB_APP_CALLBACK_URL` | API | Yes |
| `GITHUB_APP_WEBHOOK_SECRET` | API | Yes. The API refuses to start without it. |
| `COMMUNITY_CREDENTIALS_ENCRYPTION_KEY` | API, workers | Yes. The apps stack refuses to start without it. |
| `COMMUNITY_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS` | API, workers | Only during rotation |
| `COMMUNITY_MATTERMOST_ALLOWED_HOSTS` | API, community worker | No, default empty |
| `COMMUNITY_REALTIME_DEBOUNCE_MS` | API | No, default `750` |
| `COMMUNITY_INSTALL_STATE_TTL_SECONDS`, `COMMUNITY_API_REQUEST_TIMEOUT_MS`, `COMMUNITY_API_RETRY_*`, `COMMUNITY_MATTERMOST_MAX_RESPONSE_BYTES` | API, community worker | No |

All of them live in the `apps` stack. The names, defaults, and comments are in [`.env.example`](../.env.example).

## Check the setup

1. Deploy, then confirm the API and all four workers start.
2. Connect one community of each platform on the Communities page. Each row must reach **Connected**.
3. For GitHub, open the App's **Advanced > Recent Deliveries**. A delivery must show `202`. A `401` means the secret does not match. A connection error means the webhook URL is not reachable from GitHub.
4. Run one snapshot per platform and check the **DeepID publication** section of the snapshot details shows **Sent**.
