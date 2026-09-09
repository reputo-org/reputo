# DeepID integration

How Reputo reads consented users from DeepID and posts scores back. Reputo is a machine-to-machine client of the DeepID Client API through `@reputo/deep-id-api`. There is no extra service and no extra database. For the consent flow see [Voting Portal integration](voting-portal-integration.md).

## Two DID families

- `did:sub:…` is the identity DeepID mints when a user consents to Reputo. The Users API is keyed by it, and it carries the linked wallets and platform usernames.
- `did:plc:…` is the identity of a Deep Funding Portal user. The portal returns the bare 24-character value; Reputo adds the prefix.

Reputo keeps no mapping between the two. Scores are posted under the DID the algorithm worked with. DeepID unifies a user's scores on its side.

## Reading users

| Algorithms | Users | How |
| --- | --- | --- |
| `voting_engagement`, `token_value_over_time` | Consented users | The `deep-id` dependency fetches `GET /v1/users` (page size 100, DeepID's maximum), builds a `did:sub → wallets` map, and injects it as the `dids` input. Users with no wallets or no activity get an explicit `0`. |
| `discord_engagement`, `github_engagement`, `mattermost_engagement` | Consented users with a linked account | The cohort builder reads the platform field and matches by username. See [Community algorithms](community-algorithms.md#cohort-matching). |
| `proposal_engagement`, `contribution_score` | All portal users | The Users API has no portal identifier, so every portal user is scored under `did:plc`. DeepID accepts consented users and reports the rest as `dropped`. |

The platform field is `null` when the user granted the scope but linked no account, and absent when the scope is outside the token or consent. `username` is the only join key. A rename on the platform breaks the match until the user verifies again. Never log `vc`.

## Posting scores (standalone snapshots)

After a standalone snapshot completes, `post_snapshot_scores` runs:

- Best-effort: Temporal retries it, then logs and swallows a failure. It never fails the run.
- It reads the primary CSV, validates every `did` (`did:(plc|sub):` plus 24 alphanumerics), and posts in chunks of 500 to `POST /v1/clients/scores`.
- The value is the raw score. The `type` is the algorithm key. Every entry carries the workflow start time as `timestamp`, so a retry reposts the same payload and DeepID dedups on `(did, type, timestamp)`. DeepID keeps the newest timestamp per `(client, type)`.
- The result (`posted / ok / failed / dropped / skipped`) is stored in `snapshot_publications` and shown in the snapshot details as **DeepID publication** with Sent, Failed, or Pending.

`custom_score` snapshots use the lifecycle below instead.

## Encrypted custom_score lifecycle

A `custom_score` snapshot combines its child algorithms on ciphertexts. DeepID encrypts each child score (CKKS), Reputo evaluates the weighted aggregate without decrypting, and DeepID decrypts the final score. Reputo never holds a secret key. The snapshot stays `running` through every stage.

1. **Compute children.** Every child runs in its own DID namespace and cohort. Outputs are persisted while the run continues.
2. **Submit raw child scores** (`submit_custom_raw_scores`, fatal). Each child's native rows are posted under its own type with one run timestamp. The observed min and max of accepted rows become that child's normalization bounds. A child with zero accepted rows is skipped and the remaining weights are renormalized. The run fails only when every child is empty.
3. **Poll readiness** (`check_encryption_readiness`, on timers: 1 min, 15 min, 60 min, then hourly). Each pass scans all users and classifies them: `complete`, `potentiallyComplete` (something still `pending_encryption`), or `incomplete`. The deadline is 24 hours from raw submission. At the deadline the workflow fails the snapshot with `DEEPID_ENCRYPTION_TIMEOUT`.
4. **Evaluate and submit** (`submit_custom_encrypted_scores`, fatal). Each complete user's child ciphertexts are scaled to 0–100, weighted, and combined. The result is posted as `custom_score_encr` in batches of 25. Incomplete users are excluded, never zero-filled. Any rejection fails the snapshot.
5. **Complete.** Reputo does not wait for DeepID's decryption.

Diagnostics and retries:

- Every stage logs counts and DeepID request ids only. Never rows, ciphertexts, tokens, or keys.
- A pagination cursor expiry (`400` after page 1) restarts the pass from page 1, at most 3 times per poll. A `pending_encryption` field found during submission sends the run back to polling under the same deadline. Accepted entries are reposted later with the same timestamp, which DeepID dedups.
- Failure codes: `DEEPID_ENCRYPTION_READINESS_FATAL`, `DEEPID_ENCRYPTED_SUBMISSION_FATAL` (with an evaluator code such as `INCOMPATIBLE_METADATA`, `INCOMPATIBLE_CIPHERTEXT`, `CAPACITY_EXCEEDED`), `DEEPID_ENCRYPTION_TIMEOUT`. For the last one, check DeepID's encryption workers and start a new snapshot.

## Scopes

Reputo uses two DeepID OAuth clients. The admin client (`DEEP_ID_ADMIN_*`) is the dashboard login and has nothing to do with scores. The Reputo client (`DEEP_ID_CLIENT_*`) runs the browser consent flow and the machine-to-machine token.

| Variable | App | Value |
| --- | --- | --- |
| `DEEP_ID_SCOPES` | workflows | `api wallets post_scores github discord mattermost` (schema default; set a Komodo variable only to override) |
| `DEEP_ID_CONSENT_SCOPES` | API | `api wallets post_scores voting_engagement_encr contribution_score_encr proposal_engagement_encr token_value_over_time_encr github discord mattermost` (required, no default; `STAGING_` and `PRODUCTION_DEEP_ID_CONSENT_SCOPES` in Komodo) |

What each scope allows: `api wallets post_scores` are the reads and the posting; the `_encr` scopes expose a user's child ciphertexts to the encrypted `custom_score` run; the platform scopes carry the linked usernames. A user without a scope silently drops out of the matching feature.

Encrypted activities request tokens with `api`, the selected child `_encr` scopes, and `post_scores`. DeepID validates `filteredTokenScopes` on `GET /v1/users` and rejects unknown values with `400 Invalid filters`.

Roll out in order: DeepID registers the score types and allows the scopes for Reputo's client, then the variables change, then users consent again.

## Configuration notes

- Point `DEEPFUNDING_API_BASE_URL` and the DeepID hosts at the same environment. With mixed environments every `did:plc` score is dropped as `User not found`.
- `DEEP_ID_USERS_PAGE_SIZE` must stay at 100 or below.
- All variables are in [`.env.example`](../.env.example). Staging and production values are Komodo variables.

## Where the code lives

| Part | Path |
| --- | --- |
| Client (tokens, `getUsers`, `postScores`, `getSealMetadata`, schemas) | [`packages/deep-id-api`](../packages/deep-id-api) |
| User fetch and DID map | `apps/workflows/src/activities/orchestrator/deep-id.activities.ts` |
| Standalone posting | `apps/workflows/src/activities/orchestrator/deep-id-post-scores.activities.ts` |
| Raw child submission | `apps/workflows/src/activities/orchestrator/deep-id-submit-custom-scores.activities.ts` |
| Readiness and encrypted submission | `deep-id-encryption-readiness.activities.ts`, `deep-id-submit-encrypted-scores.activities.ts`, `deep-id-encrypted-cohort.ts` in the same folder |
| CKKS evaluator | `apps/workflows/src/activities/typescript/algorithms/custom-score/encrypted-evaluator/` |
| Workflow stages | `apps/workflows/src/workflows/orchestrator.workflow.ts`, `encrypted-custom-score.ts`, `encryption-readiness.ts` |
| Browser consent flow | `apps/api/src/consent/` |
