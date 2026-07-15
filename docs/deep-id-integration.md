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
   configured scopes (`api wallets post_scores`).
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

## Posting scores back

After a snapshot completes, the orchestrator runs the `post_snapshot_scores` activity:

- **Best-effort by design.** A posting failure is retried by Temporal, then logged and
  swallowed — it can never fail the reputation run.
- The primary CSV output is read (for `custom_score`: one weighted CSV per
  sub-algorithm), every `did` is validated (`did:(plc|sub):` + 24 alphanumerics), and
  scores are posted in chunks of 500 to `POST /v1/clients/scores`.
- The score `type` is the algorithm key — keys map 1:1 to DeepID score types, so there is
  no translation table. A `custom_score` snapshot posts each sub-algorithm's **weighted**
  score (`normalized score × weight ÷ total weight`) under the sub-algorithm's own type.
  Nothing is posted under `custom_score` itself — that type is reserved for the future
  aggregation step.
- Every entry carries `timestamp = completedAt`. DeepID keeps the newest timestamp per
  `(client, type)`, so re-posting after a retry is safe and an older snapshot can never
  overwrite a newer score.
- Scores are the normalized **0–100** values (the range the DeepID UI displays).
- The result reports `posted / ok / failed / dropped / skipped`. Only unexpected
  rejections are logged per DID (capped, with a summary line for the rest).

## Consent and clients

Reputo uses two DeepID OAuth clients:

- **Admin client** (`DEEP_ID_ADMIN_*`) — OIDC login for the Reputo dashboard. Unrelated to
  scores.
- **Reputo client** (`DEEP_ID_CLIENT_*`) — used twice: the browser consent flow
  (`/oauth/consent/deep-id`) that lets a voting-portal user authorize Reputo, and the M2M
  client-credentials token for `/v1` reads and writes.

Consent and token scopes are `api wallets post_scores`. The consent flow must request all
three (`DEEP_ID_CONSENT_SCOPES`), otherwise DeepID will not accept posted scores for those
users.

## Configuration

All variables live in `.env.example` (workflows read `DEEP_ID_*`; the API reads the
consent and admin variables). Staging and production values are Komodo variables — see
[Deployment](deployment.md). Two operational notes:

- Point `DEEPFUNDING_API_BASE_URL` and the DeepID hosts at the **same environment**. With
  mixed environments (for example staging DeepID and production portal) every did:plc
  score is dropped because the users do not exist on that DeepID instance.
- The integration uses exactly three scopes — `api wallets post_scores` — as the value of
  both `DEEP_ID_SCOPES` and `DEEP_ID_CONSENT_SCOPES`.

## Where the code lives

- `packages/deep-id-api` — the client: token cache/refresh, retries, `getUsers`,
  `postScores`.
- `apps/workflows/src/activities/orchestrator/deep-id.activities.ts` — consented-user
  fetch and DID-map assembly.
- `apps/workflows/src/activities/orchestrator/deep-id-post-scores.activities.ts` — the
  score posting activity.
- `apps/workflows/src/workflows/orchestrator.workflow.ts` — dependency resolution, `dids`
  input injection, and the posting call after completion.
- `apps/api/src/consent/` — the browser consent flow.
