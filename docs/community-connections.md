# Community connections

How Reputo connects to community platforms (Discord, GitHub, Mattermost), how it keeps those
connections healthy, and how to verify the health checks by hand.

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

## When health is checked

The check is always the same **probe**: list the community's resources, then read one page of
history from one of them. A passing probe proves the exact permissions a snapshot fetch needs.
It runs:

1. **On connect** — right after the install or token submit. A community that cannot be read
   never becomes `active`.
2. **On demand** — the Re-check action on the Communities page
   (`GET /community/connections/:id/health`).
3. **On snapshot failure** — when a community fetch fails during a snapshot, the orchestrator
   re-checks that connection through the API, so a kicked bot flips its row to `broken` the
   moment a run hits it. Kicked-bot categories also fail the run on the first attempt instead
   of burning the full retry budget.
4. **Periodically** — the API runs a health sweep so nobody has to press Re-check. Each pass
   re-probes connections whose last verification is older than a status-dependent threshold.
   Non-active connections are re-probed sooner, so a fix on the platform side recovers the row
   to `active` quickly on its own.

The sweep is configured by four optional variables (see `.env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `COMMUNITY_HEALTH_SWEEP_INTERVAL_MS` | `900000` (15 min) | Time between sweep passes. `0` disables the sweep. |
| `COMMUNITY_HEALTH_ACTIVE_RECHECK_AFTER_MS` | `21600000` (6 h) | Age after which an `active` connection is re-probed. |
| `COMMUNITY_HEALTH_FAILED_RECHECK_AFTER_MS` | `1800000` (30 min) | Age after which a `pending`/`degraded`/`broken` connection is re-probed. |
| `COMMUNITY_HEALTH_PROBE_SPACING_MS` | `2000` | Pause between probes inside one pass, to stay friendly to rate limits. |

A healthy connection costs at most four probes per day. Probes run one at a time, so a pass can
never burst against a platform. If the API ever runs as more than one replica, each replica
sweeps independently — harmless double probing, bounded by the thresholds.

## Freshness and auditing

`lastCheckedAt` on the connection DTO comes from the audit log
(`community_connection_audit`): it is the time of the last operation that actually exercised
the platform credential. Every sweep probe writes its own audit row with a **null actor** —
that is how you tell a system check from a human one. Sweep auditing adds only a few rows per
connection per day.

## Display metadata

A successful probe also captures display facts and stores them under `settings.metadata` on
the connection row:

- `avatarUrl` — a public CDN icon URL (Discord guild icon, GitHub account avatar). Mattermost
  has no unauthenticated icon endpoint, so it keeps the letter tile.
- `memberCount` — the approximate member count the platform reports.
- `resourceCount` — how many channels or repositories the probe could list.

Metadata is counts and public URLs only — never content. A failed probe keeps the last good
metadata; the next successful probe replaces it wholesale.

## Manual verification playbook

Use this to prove end to end that a platform-side change is caught. For a fast loop, set
`COMMUNITY_HEALTH_SWEEP_INTERVAL_MS=60000` and `COMMUNITY_HEALTH_FAILED_RECHECK_AFTER_MS=60000`
locally, or press Re-check instead of waiting.

| Platform | Do this | Expect |
| --- | --- | --- |
| Discord | Kick the Reputo bot from the server | `broken` — "rejected Reputo's credentials" or missing access |
| Discord | Remove View Channels from every channel the bot can see | `broken` — permission reason naming both permissions |
| Discord | Re-invite the bot (Reconnect) | `active` within one failed-recheck window |
| GitHub | Uninstall the App from the account | `broken` — the App is no longer installed |
| GitHub | Narrow the App to repositories without issues | probe fails with the issue-tracker reason |
| Mattermost | Disable or revoke the bot token | `broken` — token rejected |
| Mattermost | Remove the bot from every channel of the team | `broken` — no readable channel |
| Any | Fix the platform side, wait or Re-check | back to `active`, metadata refreshed |

While a connection is not `active`: the composer blocks creating a new preset for that platform
and links to the Communities page; existing presets stay editable but name the problem under
the connection field; the API rejects preset saves and snapshot creation that use it.

The automated equivalents of these scenarios live in
`apps/api/tests/e2e/community/health-sweep.test.ts` and the platform probe tests in
`packages/community-api`.
