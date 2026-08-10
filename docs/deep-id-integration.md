# DeepID integration

How Reputo reads consented users from DeepID and posts computed reputation scores back.
Reputo talks to DeepID as a machine-to-machine (M2M) client through the thin
`@reputo/deep-id-api` package — there is no extra service and no new database. For the
snapshot flow around it see [Architecture](architecture.md); for the algorithms see
[Reputation algorithms](reputation-algorithms.md). For the distributed Voting Portal
consent flow, durable source of truth, and ownership boundary see
[Voting Portal integration](voting-portal-integration.md).

## Identity model: two DID families

DeepID identifies every user with a DID. Reputo meets two families:

- **`did:sub:…`** — the identity DeepID mints when a user consents to Reputo. The
  DeepID Users API is keyed by these, and they carry the user's linked wallets.
- **`did:plc:…`** — the identity stored on Proposal Portal users (the portal returns the
  bare 24-character value; Reputo prefixes it to `did:plc:` on ingestion).

Reputo has **no mapping between the two families** and does not try to build one. Scores
are posted under whichever DID the algorithm worked with, and DeepID unifies a user's
`did:sub` and `did:plc` scores on its side.

## Reading consented users (wallet algorithms)

`voting_engagement` and `token_value_over_time` declare a `deep-id` dependency. When a
snapshot starts, the orchestrator resolves it with the `deep_id_sync` activity:

1. Fetch every consented user from `GET /v1/users` (cursor-paginated), requesting the
   configured scopes (`api wallets post_scores`). DeepID rejects a `pageSize` above 100
   with `400 Invalid pageSize`, so `DEEP_ID_USERS_PAGE_SIZE` must stay at 100 or below.
2. Assemble a `did:sub → { userWallets }` map (Ethereum and Cardano wallets; a user can
   have several) and write it to object storage under the snapshot prefix.
3. Inject the file's key as the algorithm's `dids` input (in memory only — the frozen
   preset row is not changed).

The algorithms then resolve wallets → votes or wallets → token holdings and emit one row
per consented DID. A consented user with no wallets or no activity gets an **explicit 0**,
which keeps their DeepID profile current (see the dedup rule below).

## Scoring all portal users (proposal algorithms)

`proposal_engagement` and `contribution_score` need Proposal Portal data, and the DeepID
Users API has no identifier that maps to a portal user. So these algorithms run against
**all** synced portal users (about 5k), key their rows by `did:plc:…`, and Reputo posts
every score. DeepID accepts only the users who consented to Reputo and rejects the rest
with `User not found` — an expected outcome, reported as `dropped` (not `failed`) in the
posting result. Portal users without a DID are skipped; there is nowhere to post their
score.

## Posting scores back (standalone snapshots)

After a standalone (non-`custom_score`) snapshot completes, the orchestrator runs the
`post_snapshot_scores` activity:

- **Best-effort by design.** A posting failure is retried by Temporal, then logged and
  swallowed — it can never fail the reputation run.
- The primary CSV output is read, every `did` is validated
  (`did:(plc|sub):` + 24 alphanumerics), and scores are posted in chunks of 500 to
  `POST /v1/clients/scores`.
- The posted value is the algorithm's **raw** score. Nothing is normalized, rescaled, or
  weighted on this path, and negative values are posted as-is — see
  [Raw scores](reputation-algorithms.md#raw-scores).
- The score `type` is the algorithm key — keys map 1:1 to DeepID score types, so there is
  no translation table.
- Every entry carries `timestamp = completedAt`. DeepID keeps the newest timestamp per
  `(client, type)`, so re-posting after a retry is safe and an older snapshot can never
  overwrite a newer score.
- The result reports `posted / ok / failed / dropped / skipped`. Only unexpected
  rejections are logged per DID (capped, with a summary line for the rest).

`custom_score` snapshots do not use this path. They follow the encrypted lifecycle below,
and their submissions happen **before** the snapshot completes.

## Encrypted custom_score lifecycle

A `custom_score` snapshot aggregates its selected child algorithms homomorphically:
DeepID encrypts each child score (CKKS), Reputo evaluates the weighted aggregate on the
ciphertexts without decrypting anything, and DeepID decrypts the final score. Reputo
never holds a secret key. The snapshot stays `running` through every stage and becomes
`completed` only after DeepID accepts every complete user's final entry.

The stages, in workflow order:

1. **Compute children.** Every selected child runs independently and keeps its native
   DID namespace, cohort, and S3 result file. The outputs are persisted on the snapshot
   while it is still `running`, so the child artifacts are visible during the long
   encryption window.
2. **Submit raw child scores** (`submit_custom_raw_scores`, fatal on failure). Each
   child's native CSV rows are posted verbatim under its own score type — native zeros
   included, no cross-child joins, no synthesized rows. The workflow generates one run
   timestamp (its start time) and reuses it for every raw and final entry, which makes
   every retry idempotent on DeepID's side. The observed min–max of each child's `OK`
   rows becomes that child's normalization bounds; response counts are diagnostics only.
3. **Poll encryption readiness** (`check_encryption_readiness` on durable timers: 5 min,
   15 min, 60 min, then hourly). A pass scans all `GET /v1/users` pages (page size 1000)
   and classifies each unified user: `complete` (every selected field `encrypted`),
   `potentiallyComplete` (at least one `pending_encryption`), or `incomplete` (a selected
   field `null`/absent). The run waits while any potentially complete user remains. The
   deadline is 24 hours from raw submission; at the deadline the workflow fails the
   snapshot itself with `DEEPID_ENCRYPTION_TIMEOUT` (the 30-hour Temporal run timeout is
   only a backstop and never transitions snapshot state).
4. **Evaluate and submit final scores** (`submit_custom_encrypted_scores`, fatal on
   failure). A fresh processing pass reads users in pages of 100, loads and caches the
   public SEAL metadata each complete user references, homomorphically normalizes,
   weights, and aggregates that user's child ciphertexts, and posts
   `custom_score_encr` entries (`ciphertext`, `keyId`, `type`, the fixed run timestamp)
   in batches of 25. Incomplete users are excluded — never zero-filled. Every posted
   entry must return `OK`; any rejection fails the snapshot.
5. **Complete.** Reputo does not wait for DeepID's final decryption.

### Runbook: stage diagnostics and retry behavior

Every stage logs aggregate counts and DeepID request ids only — never score rows,
ciphertext bodies, tokens, or key material.

- **Raw submission** logs, per child: `posted / ok / dropped / rejected`, the observed
  min–max, batch count, and `lastRequestId`. `dropped` counts DeepID's expected
  `User not found` rejections (no consent). A child whose accepted cohort ends empty
  fails the run. Temporal retries the activity as a whole; identical payloads and the
  fixed timestamp make reposts safe.
- **Readiness polling** logs, per pass: `complete / potentiallyComplete / incomplete`,
  `scannedUsers`, `pages`, `cursorRestarts`, and `lastRequestId`; the workflow adds the
  poll count and elapsed time. A pagination-cursor expiry (`400` after page 1) discards
  the partial pass and restarts from page 1, at most 3 restarts per poll before failing
  with `DEEPID_ENCRYPTION_READINESS_FATAL`. Auth failures and other 4xx responses fail
  immediately; 5xx/429 bubble to the Temporal retry policy.
- **Encrypted submission** logs the same pass diagnostics plus `submitted`, `batches`,
  and `registeredKeys` (distinct SEAL metadata keys). Failure types surface as
  `DEEPID_ENCRYPTED_SUBMISSION_FATAL` with an evaluator code when relevant (for example
  `INCOMPATIBLE_METADATA`, `INCOMPATIBLE_CIPHERTEXT`, `CAPACITY_EXCEEDED`). Retry
  behavior:
  - A user found with a `pending_encryption` selected field stops the pass before that
    user's page is evaluated; the workflow resumes readiness polling under the original
    24-hour deadline. Entries already accepted in the stopped pass are resubmitted later
    under the same logical identity and timestamp, which DeepID dedups.
  - Cursor expiry restarts the pass from page 1 (bounded like readiness); already
    accepted entries are safely reposted.
  - A Temporal activity retry (worker crash, 5xx, heartbeat timeout) reruns the whole
    pass; the fixed timestamp keeps every repost idempotent.
  - A rejection of any complete user's final entry, malformed or incompatible SEAL
    metadata, an incompatible ciphertext, or an evaluator failure marks the snapshot
    `failed`.
- **Timeout.** `DEEPID_ENCRYPTION_TIMEOUT` in the snapshot error means encryption was
  still pending 24 hours after raw submission. Check DeepID's encryption workers, then
  start a new snapshot; the failed run submits nothing after the deadline.

## Consent and clients

Reputo uses two DeepID OAuth clients:

- **Admin client** (`DEEP_ID_ADMIN_*`) — OIDC login for the Reputo dashboard. Unrelated to
  scores.
- **Reputo client** (`DEEP_ID_CLIENT_*`) — used twice: the browser consent flow
  (`/oauth/consent/deep-id`) that lets a voting-portal user authorize Reputo, and the M2M
  client-credentials token for `/v1` reads and writes.

Consent scopes (`DEEP_ID_CONSENT_SCOPES`) are `api wallets post_scores` plus the four
encrypted read scopes: `voting_engagement_encr`, `contribution_score_encr`,
`proposal_engagement_encr`, and `token_value_over_time_encr`. Without the first three,
DeepID will not accept posted scores for those users; without the `_encr` scopes, users
expose no child ciphertexts and silently drop out of every encrypted `custom_score` run.
DeepID validates the `filteredTokenScopes` values on `GET /v1/users` against its own
scope registry and rejects unknown ones with `400 Invalid filters` — the `_encr` scopes
only work as filters once DeepID has registered them on the target environment (checked
on staging 2026-08-05: all four `_encr` scopes were still rejected as filters, while the
identity server already granted them as token scopes).

The M2M token scopes (`DEEP_ID_SCOPES`) stay `api wallets post_scores` for the standard
reads and posts. The encrypted readiness and submission activities request their own
tokens with `api` plus exactly the selected children's `_encr` scopes, so the DeepID
client registration must allow those scopes for client-credentials tokens. The submission
activity adds `post_scores`, which `POST /v1/clients/scores` requires, and keeps it out of
the `filteredTokenScopes` it reads with — that filter must stay a subset of the token.

## Configuration

All variables live in `.env.example` (workflows read `DEEP_ID_*`; the API reads the
consent and admin variables). Staging and production values are Komodo variables — see
[Deployment](deployment.md). Two operational notes:

- Point `DEEPFUNDING_API_BASE_URL` and the DeepID hosts at the **same environment**. With
  mixed environments (for example staging DeepID and production portal) every did:plc
  score is dropped because the users do not exist on that DeepID instance.
- `DEEP_ID_SCOPES` stays `api wallets post_scores`. `DEEP_ID_CONSENT_SCOPES` must be
  `api wallets post_scores` plus the four `_encr` scopes (see above); local `.env`,
  Docker Compose, and the Komodo staging/production variables all need the full list.

## Where the code lives

- `packages/deep-id-api` — the client: token cache/refresh, retries, `getUsers`,
  `postScores`, `getSealMetadata`, encrypted-score schemas.
- `apps/workflows/src/activities/orchestrator/deep-id.activities.ts` — consented-user
  fetch and DID-map assembly.
- `apps/workflows/src/activities/orchestrator/deep-id-post-scores.activities.ts` — the
  best-effort posting activity for standalone snapshots.
- `apps/workflows/src/activities/orchestrator/deep-id-submit-custom-scores.activities.ts`
  — raw child submission and normalization observations.
- `apps/workflows/src/activities/orchestrator/deep-id-encryption-readiness.activities.ts`
  and `deep-id-submit-encrypted-scores.activities.ts` — the readiness and processing
  passes, sharing the cohort classification in `deep-id-encrypted-cohort.ts`.
- `apps/workflows/src/activities/typescript/algorithms/custom-score/encrypted-evaluator/`
  — the CKKS evaluator (normalization, weighting, aggregation on ciphertexts).
- `apps/workflows/src/workflows/orchestrator.workflow.ts` — dependency resolution, `dids`
  input injection, and the snapshot lifecycle; `encrypted-custom-score.ts` and
  `encryption-readiness.ts` drive the encrypted stages on durable timers.
- `apps/api/src/consent/` — the browser consent flow.
