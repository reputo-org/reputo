# Community connections

Reputo connects to Discord, GitHub, and Mattermost without reading message content. This page explains connection state, access checks, and live updates. For scoring, see [Community algorithms](community-algorithms.md).

## What a connection is

A connection links Reputo to one community: a Discord server, a GitHub App installation, or a Mattermost team. All three live in `community_connections`, keyed by `(platform, external_id)`: the guild id, the installation id, or `origin/teamId`. Reconnecting the same community revives the existing row.

Reputo reads ids, timestamps, and counts. It never reads message content. The Discord bot asks for View Channels and Read Message History only. The GitHub App reads issues, pull requests, and metadata. The Mattermost bot token is sealed at rest (AES-256-GCM) and opened only for the outbound call.

## Status

| Status | Shown as | Meaning |
| --- | --- | --- |
| `pending` | Checking | Saved, waiting for the first successful check. |
| `active` | Connected | The last probe read the community. |
| `degraded` | Temporary issue | The last check failed for a transient reason. |
| `broken` | Action needed | An admin must reconnect the bot or fix its access. |
| `disconnected` | Disconnected | An admin removed the connection. Kept for history, never probed. |

A failed check stores a safe category, never a platform response body. `auth_failed`, `permission_denied`, `not_found`, and `outbound_policy` mean `broken`. `rate_limited`, `network_error`, `upstream_error`, and `contract_violation` mean `degraded`.

## Two levels of access

A connection has global access (the bot is in the community and its credentials work) and per-resource access (the bot can read each channel or repository). Every listed resource carries the platform's verdict: `readable: true`, or `readable: false` with an `accessIssue`.

| Platform | Global check | Per-resource verdict |
| --- | --- | --- |
| Discord | The bot is in the guild and its token works. | Effective permissions per channel, resolved like Discord does (roles, Administrator, channel overwrites). `missing_view_channel` or `missing_read_history`. |
| GitHub | The installation exists, is not suspended, and still grants issues, pull requests, and metadata. | A repository with its issue tracker off is `issues_disabled`. |
| Mattermost | The token works and the bot is in the team. | Channels the bot joined are readable. Public channels it has not joined get one sampled read; otherwise `not_member`. |

A preset can select readable resources only. The API rejects a save or a snapshot that names an unreadable one and says which and why.

## When Reputo checks

Every check is the same **probe**: list the resources with their verdicts, then read one page of history from a readable one. It runs:

1. On connect. A community that cannot be read never becomes Connected.
2. On demand, with **Check again** (`GET /community/connections/:id/health`).
3. When a community fetch fails during a snapshot. The orchestrator re-checks the connection, so a kicked bot flips its row the moment a run hits it. Those categories fail the run at once instead of retrying.
4. When the platform reports a change (next section).

Nothing re-probes on a timer. Listing resources and preset validation are health signals too: a platform failure there moves the row like a failed probe.

## Live feeds

Each platform has one transport that reports configuration changes. Reputo follows it.

| Platform | Transport | Reports |
| --- | --- | --- |
| Discord | Gateway WebSocket, one socket for the bot (`GUILDS` intent) | Channel, role, and guild changes; a fresh install; the bot being kicked. |
| GitHub | App webhook deliveries to `POST /community/webhooks/github` | Installation removed, suspended, restored, or re-scoped; repositories added or removed; a repository renamed, deleted, made private, or its issues turned off. |
| Mattermost | WebSocket API, one socket per connected team | Channel created, deleted, restored, updated, or converted; the bot added to or removed from a channel; team changes. |

An event is a hint, never a fact. It triggers the same probe as Check again, so the stored state is always what the platform's API returns. Events for one community inside `COMMUNITY_REALTIME_DEBOUNCE_MS` (default 750 ms) collapse into one probe. An event during a running probe schedules exactly one more. Probes run one at a time. Sockets open when the first community of a platform is connected and close with the last one, on every replica, driven by the same PostgreSQL `NOTIFY` channel as the SSE stream.

Some changes do not reach a feed. The row keeps its old state until **Check again**, the next snapshot, or another event:

- Discord: a role added to or removed from the bot itself (needs the privileged `GUILD_MEMBERS` intent, which Reputo does not request).
- GitHub: a delivery lost while the API was down. GitHub does not retry.
- Mattermost: a channel created by another user. Mattermost sends that event to the creator only.

GitHub needs the webhook URL, secret, and events configured on the App. See [Community platform setup](community-platform-setup.md#github-app). Discord and Mattermost need nothing beyond the tokens already in use.

An idle community costs nothing: no timer, no polling. A connection costs one probe per real change, plus one on connect, one per Check again, and one per snapshot.

## How changes reach the browser

Triggers on `community_connections` notify `community_connection_updates` on insert, delete, and every update that changes what a client can see. The API listens, reloads the row, and sends `community_connection:updated` or `community_connection:removed` to every SSE client. The first event of a stream, `community_connection:watch`, carries which platform feeds are live, and is sent again when a feed changes state.

The UI keeps one stream per page. On an event it refetches the connection list and the affected connection's resources, so the composer's picker updates while it is open. If the stream drops it reconnects and refetches. The page never polls. A row shows when it was last checked only while its platform's feed is down.

Behind proxies: the API sends a heartbeat every 15 s, the browser reconnects after 45 s of silence, and the `LISTEN` connection runs a keepalive query every 30 s.

## Audit and metadata

Each row keeps its check state in `settings.lastCheck` (when the platform last answered, and the failure category). `community_connection_audit` records every human action (connect, Check again, listing resources, disconnect) and every status transition a system check causes, with a null actor.

A successful probe stores display facts in `settings.metadata`: `avatarUrl` (Discord and GitHub), `memberCount`, `resourceCount`, `readableResourceCount`, and a fingerprint of the listing (ids, names, verdicts) so a rename or a hidden channel reaches open pages. Counts and public URLs only.

## The resource picker

The preset composer lists a connection's resources as a searchable list with **Select all with access** and **Clear**. Unreadable resources sit under **No access**, locked, with the missing permission and how to grant it. A stored selection the bot can no longer read gets **Remove unreadable**. The list is live through the events stream.

While a connection is not Connected, the composer blocks new presets for that platform and links to the Communities page. Existing presets stay editable but name the problem.
