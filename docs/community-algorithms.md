# Community algorithms

How `discord_engagement`, `github_engagement`, and `mattermost_engagement` turn platform activity into scores. For connecting a platform see [Community connections](community-connections.md). For operator setup see [Community platform setup](community-platform-setup.md).

## The pipeline

1. An admin connects a community and saves a preset: the connection, the channels or repositories, a time period (`lookback_days`), and the activities to score.
2. A snapshot starts. The orchestrator fixes the window `[start − lookback_days, start)` from the workflow start time. The maximum lookback is 183 days.
3. The community worker fetches the window and freezes it as a dataset in object storage. One fetch runs at a time (`maxConcurrentActivityTaskExecutions: 1` on the `community-worker` queue). Other community snapshots wait in the queue.
4. The worker builds the cohort: consented DeepID users matched to platform accounts.
5. The algorithm worker scores from the frozen dataset only and writes the CSV and details JSON.
6. The orchestrator posts the scores to DeepID. See [DeepID integration](deep-id-integration.md).

After the freeze nothing changes the result: not platform edits, deploys, or retries. Replaying a dataset gives byte-identical outputs.

## The dataset

Every community snapshot owns one dataset under `snapshots/<id>/community_<platform>/`:

| File | Content |
| --- | --- |
| `activities.parquet` | One row per activity: `type`, `actor`, `counterparty` (nullable), `resource`, `object_id`, `occurred_at` (UTC), `count`, `bot`, `deleted`. Sorted, zstd-compressed. |
| `cohort.parquet` | One row per consented user: `did`, `username`, `account_id`, `status` (`matched` or `unmatched`). |
| `coverage.parquet` | One row per selected resource: `resource`, `status` (`complete`, `partial`, `failed`), `reason`. |
| `manifest.json` | `schemaVersion` (2), `platform`, `snapshotId`, `window`, per-file `sha256`, `bytes`, `rows`, `fetchStats`, and the DuckDB version. |

The manifest is written last and is the commit. A dataset without a manifest does not exist. A retry that finds a manifest verifies the hashes and stops. During the fetch, rows stream to gzipped NDJSON segments under `staging/` (5,000 rows each) and the resume cursor is checkpointed in Temporal heartbeats, so a retry resumes instead of restarting. Segments are deleted after the commit.

No message text, titles, or bodies are stored. Only IDs, timestamps, and counts.

A resource is `partial` when some of it could not be read after progress was made, and `failed` when nothing could be read. The snapshot fails only when every selected resource failed.

Deleting a snapshot deletes its dataset with the rest of the snapshot prefix. There is no other copy.

## Cohort matching

The cohort is built inside the freeze, before the manifest. Reputo reads consented users from DeepID with the platform scope (`api discord`, `api github`, or `api mattermost`) and takes the `username` DeepID stores for that platform. It is the only join key DeepID offers.

| Platform | Lookup |
| --- | --- |
| Discord | `GET /guilds/{id}/members/search`, exact username match. No privileged intent. |
| GitHub | `GET /users/{login}`, the numeric user id. |
| Mattermost | `POST /users/usernames` in chunks of 100. |

A consented user with no match is scored `0` with status `unmatched`. A matched user with no activity is scored `0`. Users without consent never appear in the cohort. Their activity stays in the dataset only as pseudonymous counterparties.

## Activities and timestamps

| Platform | Activities | Timestamp rule |
| --- | --- | --- |
| Discord | `message`, `reply`, `reaction_received`, `reply_received`, `mention_received`, `active_day` | The message's creation time. `reply_received` uses the parent message's time. Reactions carry a count and no counterparty. |
| Mattermost | `message`, `reply`, `reaction_received`, `reply_received`, `active_day` | The post's creation time. `reply_received` uses the thread root's time. Reactions are one row per reactor. No `mention_received`: Mattermost exposes no mention list and Reputo never reads text. |
| GitHub | `pull_request_opened`, `pull_request_merged`, `pull_request_review`, `issue_opened`, `comment` | Creation time. A merged pull request uses its merge time and is credited to the author. A review uses its submission time. No `active_day`. |

Bots are flagged in the dataset and excluded from scoring. Deleted content is absent.

## Scoring

The engine is shared: [`community-engagement/`](../apps/workflows/src/activities/typescript/algorithms/community-engagement/). Each platform algorithm is a thin wrapper that sets the activity list.

- Units are summed per user, activity, and UTC day in SQL, then capped by the activity's `daily_cap`.
- `active_day` counts one unit per UTC day with a `message` or `reply`. Its cap bounds the number of credited days in the whole window.
- Points are `capped units × points`, applied in the platform's activity order and rounded to 6 decimals. The score is the sum.
- Every activity row in the preset needs `points > 0` and an integer `daily_cap ≥ 1`. Leaving an activity out disables it.

Outputs:

- `<algorithm>.csv` with `did`, `<algorithm>`, and one `<activity>_points` column per activity.
- `<algorithm>_details.json` with `users` (per user: `did`, `status`, `username`, `account_id`, `score`, `activities`) and `metadata` (`window`, `cohort` counts, `coverage`, the configured `activities`).

Scores stay raw. A community algorithm can be a `custom_score` child. Normalization and weighting happen there, like for every other child.

## Where the code lives

| Part | Path |
| --- | --- |
| Platform clients and adapters | [`packages/community-api/src/<platform>/`](../packages/community-api/src) |
| Record contract and adapter interface | [`packages/community-api/src/shared/records.ts`](../packages/community-api/src/shared/records.ts) |
| Dataset engine and cohort | [`apps/workflows/src/activities/community/`](../apps/workflows/src/activities/community) |
| Scoring engine and wrappers | [`apps/workflows/src/activities/typescript/algorithms/`](../apps/workflows/src/activities/typescript/algorithms) |
| Storage keys | [`apps/workflows/src/shared/constants/storage-keys.ts`](../apps/workflows/src/shared/constants/storage-keys.ts) |
