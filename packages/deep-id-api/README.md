# @reputo/deep-id-api

A small, framework-agnostic TypeScript client for the **DeepID Client API**, used
by Reputo as a machine-to-machine (M2M) integration. It handles the OAuth 2.0
**client-credentials** token (cached and refreshed before expiry) and exposes the
endpoints Reputo needs:

- `getUsers` / `iterateUsers` — list consented users from `GET /v1/users`,
  paginated via the `x-next` response header (page size 100 by default, which is
  DeepID's maximum).
- `getSealMetadata` — fetch the public SEAL/CKKS parameters referenced by a
  user's `scores_encr['seal-metadata']` URL.
- `postScores` — submit plaintext child scores or the final encrypted
  `custom_score_encr` via `POST /v1/clients/scores`.

The package reads no environment variables; the consuming app validates its env
and passes the values to the factory.

## Usage

```ts
import { createDeepIdClient, isValidDid } from '@reputo/deep-id-api';

const client = createDeepIdClient({
  identityBaseUrl: 'https://identity.staging.deep-id.ai',
  appBaseUrl: 'https://app.staging.deep-id.ai',
  clientId: process.env.DEEP_ID_CLIENT_ID!,
  clientSecret: process.env.DEEP_ID_CLIENT_SECRET!,
  // scopes defaults to 'api wallets post_scores'
});

// Read consented users (did:sub → { scopes, wallets, scores })
const users = await client.getUsers({ filteredTokenScopes: 'api wallets post_scores' });

// Post scores keyed by DID (did:sub or did:plc). DeepID dedups newest-timestamp-wins.
// A score of 0 is a valid score and is posted as-is.
const result = await client.postScores({
  'did:sub:abc123abc123abc123abc123': {
    score: 82,
    type: 'voting_engagement',
    timestamp: '2026-06-12T10:00:00Z',
  },
});
console.log(result.status); // { ok, failed }
```

## Encrypted score contracts

The homomorphic `custom_score` flow reads encrypted child scores, loads the SEAL
metadata, and submits one final encrypted score per complete user. All three
contracts are validated at runtime; a violation throws `DeepIdContractError`
(never retryable, and never containing scores, ciphertexts, or tokens).

### Read encrypted child scores

Request the encrypted scopes and validate each user's `scores_encr`. A child
field is `absent`/`null` (no encrypted score for this user), `pending_encryption`
(wait), or `encrypted` (ciphertext ready — a ready field without a ciphertext is
rejected). Unknown statuses are rejected, never coerced.

```ts
import { ENCRYPTED_SCORE_SCOPES, parseEncryptedScores } from '@reputo/deep-id-api';

const scopes = `api ${ENCRYPTED_SCORE_SCOPES.join(' ')}`;
for await (const page of client.iterateUsers({ pageSize: 50, filteredTokenScopes: scopes })) {
  for (const [did, user] of Object.entries(page.users)) {
    const scoresEncr = parseEncryptedScores(user.scores_encr); // undefined when absent
    const field = scoresEncr?.voting_engagement_encr;
    if (field?.status === 'encrypted') {
      // field.ciphertext is a non-empty serialized CKKS ciphertext
    }
  }
}
```

### Load SEAL metadata

`seal-metadata` is a relative URL. The client resolves it against the configured
`appBaseUrl` origin and rejects off-origin URLs and redirects.

```ts
const metadata = await client.getSealMetadata(scoresEncr['seal-metadata']!);
// { id, schemeType: 'ckks', securityLevel, polyModulusDegree,
//   coeffModulusBitSizes, scale, encryptionParameters }
```

### Submit the final encrypted score

An entry is either plaintext (`score`) or encrypted (`ciphertext` + `keyId`) —
never both. `keyId` is the `id` of the metadata used for evaluation.

```ts
await client.postScores({
  'did:sub:abc123abc123abc123abc123': {
    ciphertext: evaluatedCiphertextBase64,
    keyId: metadata.id,
    type: 'custom_score_encr',
    timestamp: runTimestamp, // the same fixed ISO timestamp for the whole run
  },
});
```

### Idempotent retries

DeepID guarantees idempotency for retries of the same logical entry and run
timestamp. The client never generates or replaces timestamps and serializes the
entry map exactly as passed, so bounded HTTP retries (built in) and Temporal
retries are safe — as long as the caller resends the identical payload with the
same run timestamp. Retrying a changed payload for the same DID, type, and
timestamp is invalid caller behavior.

## Notes

- **Token** is acquired via HTTP Basic Auth (`clientId` / `clientSecret`) and cached
  until `tokenRefreshSkewMs` before expiry. A `401` triggers one refresh + retry.
- **Pagination** cursors expire after 5 minutes — don't pause mid-walk. Use
  `iterateUsers` for large datasets and `getUsers` for the merged map.
- **Identifiers** are posted verbatim; use `isValidDid` to validate the
  `did:(plc|sub):[a-zA-Z0-9]{24}` format before posting.
- **Validation**: `postScores` payloads and responses, `scores_encr`, and SEAL
  metadata are checked with exported Zod schemas; a mismatch throws
  `DeepIdContractError` with path-only issues.
- **Diagnostics**: `postScores` returns the `x-request-id` response header as
  `requestId`. Quote it when reporting problems; never log score bodies,
  ciphertexts, tokens, or secret material.
- **Errors**: transient failures (429, 5xx, network/timeout) are retried with
  exponential backoff + jitter; other 4xx throw `HttpError`. `POST /v1/clients/scores`
  returns `200` even with per-user failures — inspect `status.failed` and `results`.

See the generated API docs (`pnpm --filter @reputo/deep-id-api docs`) and the
DeepID Client API spec for the full contract.
