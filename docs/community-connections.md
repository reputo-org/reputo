# Community connections

How Reputo connects to community platforms (Discord, GitHub, Mattermost), how it decides which
channels or repositories the bot can read, how it keeps those connections healthy in real time,
and how to verify the health checks by hand.

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
4. **Periodically** — the API runs a health sweep so nobody has to press Re-check. Each pass
   re-probes connections whose last check is older than a status-dependent threshold.
   Non-active connections are re-probed sooner, so a fix on the platform side recovers the row
   to `active` quickly on its own.
5. **Live, while someone is looking** — the Communities page and every community preset
   composer open the events stream (`GET /community/connections/events`, Server-Sent Events).
   While at least one stream is open, the sweep switches to its **watch cadence** and re-probes
   every connection every `COMMUNITY_HEALTH_WATCH_INTERVAL_MS`. A permission change on the
   platform — a channel hidden from the bot, the bot kicked, a repository's issues turned off —
   shows up on the open page within that interval, no click needed. The cadence stops with the
   last client.

Listing resources (`GET /community/connections/:id/resources`) and preset validation are health
signals too: a platform failure there moves the row like a failed probe would.

The sweep is configured by five optional variables (see `.env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `COMMUNITY_HEALTH_SWEEP_INTERVAL_MS` | `900000` (15 min) | Time between sweep passes. `0` disables the sweep. |
| `COMMUNITY_HEALTH_ACTIVE_RECHECK_AFTER_MS` | `21600000` (6 h) | Age after which an `active` connection is re-probed. |
| `COMMUNITY_HEALTH_FAILED_RECHECK_AFTER_MS` | `1800000` (30 min) | Age after which a `pending`/`degraded`/`broken` connection is re-probed. |
| `COMMUNITY_HEALTH_PROBE_SPACING_MS` | `2000` | Pause between probes inside one pass, to stay friendly to rate limits. |
| `COMMUNITY_HEALTH_WATCH_INTERVAL_MS` | `30000` (30 s) | Re-probe cadence for every connection while a client follows the events stream. `0` disables the watch cadence. |

A healthy connection that nobody is looking at costs at most four probes per day. On the watch
cadence a Discord probe is five requests (channels, bot member, roles, one history page, the
guild), a GitHub probe three, a Mattermost probe about five; probes still run one at a time with
the spacing pause, so a pass can never burst against a platform. If the API ever runs as more
than one replica, each replica sweeps independently and every replica's events reach every
client, because changes travel over PostgreSQL `NOTIFY`.

## How changes reach the browser

The `community_connections` table carries triggers that `NOTIFY community_connection_updates`
on every insert and delete, and on an update that changes what a client can see: the status, the
name, or the stored settings other than the check timestamp. The API listens on a dedicated
connection, reloads the row, and fans it out to every subscribed SSE client as
`community_connection:updated` (or `community_connection:removed`). The first event of a stream
is `community_connection:watch`, announcing the watch cadence, which the Communities page shows
as its "Live" line.

The UI keeps one stream per page, shared by every component that shows connections. On an event
it refetches the connection list and the affected connection's resources, so the composer's
channel picker updates while it is open. If the stream drops, the page falls back to polling
once a minute and reconnects.

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
listing resources, disconnect — and every **transition** a system check causes: a sweep, watch,
or snapshot-failure probe writes a row, with a null actor, only when it changes the status or
the failure category. That is how you tell a system check from a human one, and why the watch
cadence leaves a transition history rather than a heartbeat log.

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
the listing and its verdicts, so a change in which channels are readable moves the row — and
reaches open pages — even when the counts stay the same.

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
(or a community preset composer) open: that turns the watch cadence on, so each expectation
lands within `COMMUNITY_HEALTH_WATCH_INTERVAL_MS` (30 s by default) without pressing Re-check.
Press Re-check to skip the wait.

| Platform | Do this | Expect |
| --- | --- | --- |
| Discord | Kick the Reputo bot from the server | `broken` — the bot is no longer in the server or lacks both permissions |
| Discord | Remove View Channels from every channel the bot can see | `broken` — permission reason naming both permissions |
| Discord | Hide one channel from the bot (deny View Channel in that channel) | Still `active`; the row shows "n of m channels readable"; in the composer the channel moves under "No access" as "Can't view" and cannot be selected |
| Discord | Deny Read Message History on one channel | Same, as "No history" |
| Discord | Grant the permission back | The channel returns to the readable list within one watch interval |
| Discord | Re-invite the bot (Reconnect) | `active` within one watch interval |
| GitHub | Uninstall the App from the account | `broken` — the App is no longer installed |
| GitHub | Suspend the App on the account | `broken` — uninstalled or suspended |
| GitHub | Turn issues off in one repository | Still `active`; the repository is listed under "No access" as "Issues off" |
| GitHub | Narrow the App to repositories without issues | `broken` — no repository with its issue tracker on |
| Mattermost | Disable or revoke the bot token | `broken` — token rejected |
| Mattermost | Remove the bot from every channel of the team | `broken` — no readable channel (unless the server lets team members read public channels) |
| Mattermost | Invite the bot to a public channel it was not in | The channel appears (or turns readable) within one watch interval |
| Any | Fix the platform side, wait or Re-check | back to `active`, metadata refreshed |

While a connection is not `active`: the composer blocks creating a new preset for that platform
and links to the Communities page; existing presets stay editable but name the problem under
the connection field; the API rejects preset saves and snapshot creation that use it. A preset
that selects an unreadable resource is rejected too, naming the resource and the missing access.

The automated equivalents of these scenarios live in
`apps/api/tests/e2e/community/health-sweep.test.ts`, `apps/api/tests/e2e/community/events.test.ts`,
and the platform probe tests in `packages/community-api`.
