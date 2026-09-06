# Community connections

How Reputo connects to community platforms (Discord, GitHub, Mattermost), how it decides which
channels or repositories the bot can read, how each platform pushes its changes to Reputo in real
time, and how to verify the health checks by hand.

## What a connection is

A connection links Reputo to one community: a Discord server, a GitHub App installation, or a
Mattermost team. All three live in one table, `community_connections`, keyed by
`(platform, external_id)`. Reconnecting the same community revives the existing row instead of
creating a second one.

Reputo reads ids, timestamps, and counts only — never message content. The Discord bot asks for
View Channels and Read Message History and nothing more; the GitHub App reads issues, pull
requests, and metadata; the Mattermost bot token is sealed (AES-256-GCM) and only opened at the
moment of an outbound call.

## Status model

| Status | Meaning |
| --- | --- |
| `pending` | Saved, waiting for the first successful check. |
| `active` | The last probe read the community successfully. |
| `degraded` | The last check failed for a transient reason (rate limit, network, platform error). |
| `broken` | An admin has to act: reconnect the bot or fix its access. |
| `disconnected` | An admin removed the connection. Kept for history, never probed. |

A failed check carries a safe category, never a platform response body. Categories map to a
status like this: `auth_failed`, `permission_denied`, `not_found`, and `outbound_policy` mean
`broken`; everything else (`rate_limited`, `network_error`, `upstream_error`,
`contract_violation`) means `degraded`.

## Two levels of access

A connection has **global** access — the bot is in the community and its credentials work — and
**per-resource** access: whether the bot can actually read each channel or repository. Both are
checked by every probe, and every resource the API lists carries the platform's own verdict:
`readable: true`, or `readable: false` with an `accessIssue` naming what blocks it.

| Platform | Global check | Per-resource verdict |
| --- | --- | --- |
| Discord | The bot is in the guild and its token works. | Effective permissions per channel, resolved the way Discord does: the @everyone role, the bot's roles, Administrator, then the channel overwrites (@everyone, roles, the bot member). Missing View Channel → `missing_view_channel`; missing Read Message History → `missing_read_history`. Discord lists private channels the bot cannot see, so without this the picker would offer them. |
| GitHub | The installation exists (an uninstalled App answers 404), is not suspended, and still grants issues, pull requests, and metadata. | The installation grants its permissions to every repository it lists; a repository with its issue tracker off → `issues_disabled` (the crawl reads `/issues`, which that repository refuses). |
| Mattermost | The token works and the bot is in the team. | Channels the bot is in are readable. Public channels it has not joined are listed too; one sampled read decides whether the server lets team members read them (`read_public_channel`, withdrawn under compliance mode) → otherwise `not_member`. |

The probe samples only readable resources, and it fails as `permission_denied` when none is
readable. A preset can only select readable resources: the API rejects a save or a snapshot that
names an unreadable one, and says which and why.

## When health is checked

The check is always the same **probe**: list the community's resources with their verdicts, then
read one page of history from a readable one. A passing probe proves the exact permissions a
snapshot fetch needs. It runs:

1. **On connect** — right after the install or token submit. A community that cannot be read
   never becomes `active`.
2. **On demand** — the Re-check action on the Communities page
   (`GET /community/connections/:id/health`).
3. **On snapshot failure** — when a community fetch fails during a snapshot, the orchestrator
   re-checks that connection through the API, so a kicked bot flips its row to `broken` the
   moment a run hits it. Kicked-bot categories also fail the run on the first attempt instead
   of burning the full retry budget.
4. **Whenever a platform says something changed** — see the next section. This is the normal
   case: a permission change on the platform reaches an open page in about a second, with
   nobody polling anything.

Nothing re-probes on a timer. A connection is read when a platform says it changed, when a
snapshot uses it, or when an admin presses Re-check — and never otherwise.

Listing resources (`GET /community/connections/:id/resources`) and preset validation are health
signals too: a platform failure there moves the row like a failed probe would.

## Live feeds: how each platform pushes its changes

Every platform has exactly one transport that reports configuration changes, and Reputo follows
it. None of them is optional-but-equivalent — there is no second way to hear about a hidden
channel or an uninstalled App.

| Platform | Transport | What it reports |
| --- | --- | --- |
| Discord | Gateway WebSocket, one socket for the whole bot. Discord publishes no webhook for guild state. | `CHANNEL_CREATE/UPDATE/DELETE`, `GUILD_ROLE_CREATE/UPDATE/DELETE`, `GUILD_UPDATE`, `GUILD_CREATE` (a fresh install), `GUILD_DELETE` (kicked). |
| GitHub | App webhook deliveries to `POST /community/webhooks/github`. | `installation` (removed, suspended, restored, re-scoped), `installation_repositories` (a repository added or removed), `repository` (renamed, deleted, made private, issue tracker turned off). |
| Mattermost | WebSocket API, one socket per connected team. Outgoing webhooks fire on messages, not on configuration. | `channel_created/deleted/restored/updated/converted`, the bot being added to or removed from a channel, and team-level changes. |

A platform event is treated as a **hint, never as a fact**. Reputo does not try to replay
Discord's permission model from deltas: an event only says "this community changed", and the
answer comes from the same probe an on-demand Re-check runs. So the row a client sees is always
what the platform's REST API actually returns — the view a snapshot fetch depends on — and a
duplicate or out-of-order event costs nothing.

Signals are coalesced twice. Events for one community inside
`COMMUNITY_REALTIME_DEBOUNCE_MS` collapse into one probe, because a single admin action fans out
into several events. An event that arrives while that connection's probe is already running
schedules exactly one more, so the stored state is never the stale answer. Probes run one at a
time.

The feeds follow what is connected: the Gateway socket opens while any Discord community is
connected and closes when the last one goes, and a Mattermost team gets its socket the moment it
is connected — no restart. Reputo learns about that from the same PostgreSQL `NOTIFY` channel
that drives the SSE stream, so it works on every replica. Mattermost tokens are unsealed per
connection attempt rather than held for the life of the socket, and reach the server as an
upgrade header, never as a frame.

### What the live feeds cannot see

These two cases reach no feed, so the row keeps its previous answer until a Re-check, the next
snapshot run, or the next event that does arrive:

- **Discord**: a role being *added to or removed from the bot itself* arrives as
  `GUILD_MEMBER_UPDATE`, which needs the privileged `GUILD_MEMBERS` intent. Reputo runs on the
  non-privileged `GUILDS` intent, in keeping with its read-only install. A change to the
  *permissions of a role the bot holds* does arrive, and that is the common case.
- **GitHub**: GitHub does not retry a failed delivery. A delivery lost while the API was down is
  gone.

### Operator setup

- **GitHub**: set the App's Webhook URL to `{API public URL}/api/v1/community/webhooks/github`,
  set its secret, and put the same value in `GITHUB_APP_WEBHOOK_SECRET`. Subscribe the App to
  the **Installation**, **Installation target**, and **Repository** events. The endpoint is the
  one community route without a session: GitHub authenticates by signing every delivery, and the
  signature is verified against the raw request bytes in constant time. A missing, wrong, or
  unverifiable signature is refused with `401` and identical wording, so nothing about the
  secret leaks. `GITHUB_APP_WEBHOOK_SECRET` is required — the API refuses to start without it,
  because a GitHub change reaches Reputo no other way.
- **Discord** and **Mattermost**: nothing to configure. The bot token and the sealed team tokens
  already in use are what the sockets authenticate with.

### Cost

| Variable | Default | Meaning |
| --- | --- | --- |
| `GITHUB_APP_WEBHOOK_SECRET` | — | **Required.** Secret on the App's webhook; every delivery is signed with it. |
| `COMMUNITY_REALTIME_DEBOUNCE_MS` | `750` | Window in which repeated signals for one community collapse into a single probe. |

A connection costs one probe per actual change on the platform, plus one on connect, one per
Re-check, and one per snapshot that uses it. An idle community costs nothing at all: the sockets
sit open without spending requests, and no timer re-probes anything, so a page left open all day
adds no platform traffic.

Each replica opens its own sockets and receives its own webhook deliveries; a probe by any
replica reaches every client, because changes travel over PostgreSQL `NOTIFY`.

## How changes reach the browser

The `community_connections` table carries triggers that `NOTIFY community_connection_updates`
on every insert and delete, and on an update that changes what a client can see: the status, the
name, or the stored settings other than the check timestamp. The API listens on a dedicated
connection, reloads the row, and fans it out to every subscribed SSE client as
`community_connection:updated` (or `community_connection:removed`). The first event of a stream
is `community_connection:watch`, carrying the **feed status**: which platforms are pushing their
changes right now. It is sent again whenever a feed changes state, and the Communities page turns
it into its "Live" line — "Discord changes appear as they happen", or "Not live — the GitHub feed
is reconnecting; Re-check to see changes now".

The UI keeps one stream per page, shared by every component that shows connections. On an event
it refetches the connection list and the affected connection's resources, so the composer's
channel picker updates while it is open. If the stream drops it reconnects and refetches on the
way back in; the page never polls, because the stream has already delivered whatever a refetch
would find.

A connection row shows *when it was last checked* only while its platform's feed is down. Under a
live feed the row is current to the second, so a "Checked 12 minutes ago" line would date the
last probe rather than the data, and read as stale when nothing is. The absolute timestamps stay
in the row's tooltip either way.

Two safeguards keep this honest behind proxies. The API sends a `community_connection:heartbeat`
every 15 s, so a reverse proxy or the Next.js rewrite (whose upstream inactivity timeout is 30 s
by default) never sees an idle stream; the browser treats 45 s of silence as a dead stream and
reconnects, because a proxy can drop the API's half of a stream while leaving the browser's half
open. On the database side, the API's `LISTEN` connection runs a `SELECT 1` every 30 s with TCP
keepalive on, so a connection that died silently is reconnected rather than left listening to
nothing, and any notification a proxy held back on an idle socket comes through with the reply.

## Freshness and auditing

Each connection row stores its own check state under `settings.lastCheck`: when the platform last
answered, and the failure category if that check failed. `lastCheckedAt` and `statusReason` on
the connection DTO come from there, so a row is never fresher than its last real platform
answer, and every replica sees every replica's checks.

The audit log (`community_connection_audit`) records every human action — connect, Re-check,
listing resources, disconnect — and every **transition** a system check causes: a live-feed
probe or a snapshot-failure write-back writes a row, with a null actor, only when
it changes the status or the failure category. That is how you tell a system check from a human
one, and why a busy community leaves a transition history rather than a heartbeat log.

## Display metadata

A successful probe also captures display facts and stores them under `settings.metadata` on
the connection row:

- `avatarUrl` — a public CDN icon URL (Discord guild icon, GitHub account avatar). Mattermost
  has no unauthenticated icon endpoint, so it keeps the letter tile.
- `memberCount` — the approximate member count the platform reports.
- `resourceCount` — how many channels or repositories the probe could list.
- `readableResourceCount` — how many of those the bot can read. The Communities page shows
  "10 of 12 channels readable" once they differ.

Metadata is counts and public URLs only — never content. A failed probe keeps the last good
metadata; the next successful probe replaces it wholesale. The probe also stores a fingerprint of
the listing — the ids, the names, and the read verdicts — so a channel being renamed or hidden
moves the row, and reaches open pages, even when the counts stay the same.

## The resource picker

The preset composer lists a connection's resources as an always-open, searchable list with
"Select all readable" and "Clear". Every resource shows the platform's verdict: unreadable ones
sit under a "No access" heading, locked, with the missing permission named and the rule that
would make them readable (for example "Allow View Channel for the Reputo role in the channel's
permission settings"). A stored selection the bot can no longer read is flagged with a one-click
"Remove unreadable"; a stored id the connection no longer lists stays visible as a removable
entry. The list is live through the events stream.

## Manual verification playbook

Use this to prove end to end that a platform-side change is caught. Keep the Communities page
(or a community preset composer) open and watch the "Live" line: while the platform's feed is
live, each expectation below lands within a second or two of the change on the platform, with no
click. If the line says a feed is reconnecting, nothing lands for that platform until it is back
— press Re-check to read the platform now.

For GitHub, check the App's **Advanced → Recent Deliveries** page if nothing arrives: a `401`
there means `GITHUB_APP_WEBHOOK_SECRET` does not match the App's secret, and a connection error
means the Webhook URL is not reachable from GitHub (a localhost API needs a tunnel).

| Platform | Do this | Expect |
| --- | --- | --- |
| Discord | Kick the Reputo bot from the server | `broken` — the bot is no longer in the server or lacks both permissions |
| Discord | Remove View Channels from every channel the bot can see | `broken` — permission reason naming both permissions |
| Discord | Hide one channel from the bot (deny View Channel in that channel) | Still `active`; the row shows "n of m channels readable"; in the composer the channel moves under "No access" as "Can't view" and cannot be selected |
| Discord | Deny Read Message History on one channel | Same, as "No history" |
| Discord | Grant the permission back | The channel returns to the readable list right away |
| Discord | Re-invite the bot (Reconnect) | `active` right away |
| GitHub | Uninstall the App from the account | `broken` — the App is no longer installed |
| GitHub | Suspend the App on the account | `broken` — uninstalled or suspended |
| GitHub | Turn issues off in one repository | Still `active`; the repository is listed under "No access" as "Issues off" |
| GitHub | Narrow the App to repositories without issues | `broken` — no repository with its issue tracker on |
| Mattermost | Disable or revoke the bot token | `broken` — token rejected |
| Mattermost | Remove the bot from every channel of the team | `broken` — no readable channel (unless the server lets team members read public channels) |
| Mattermost | Invite the bot to a public channel it was not in | The channel appears (or turns readable) right away |
| Any | Fix the platform side, wait or Re-check | back to `active`, metadata refreshed |

While a connection is not `active`: the composer blocks creating a new preset for that platform
and links to the Communities page; existing presets stay editable but name the problem under
the connection field; the API rejects preset saves and snapshot creation that use it. A preset
that selects an unreadable resource is rejected too, naming the resource and the missing access.

The automated equivalents of these scenarios live in
`apps/api/tests/e2e/community/realtime.test.ts` (a platform event or a signed delivery through to
an SSE event), `apps/api/tests/e2e/community/events.test.ts`, and the event-mapping and probe
tests in `packages/community-api`.
