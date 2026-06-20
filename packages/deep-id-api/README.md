# @reputo/deep-id-api

A small, framework-agnostic TypeScript client for the **DeepID Client API**, used
by Reputo as a machine-to-machine (M2M) integration. It handles the OAuth 2.0
**client-credentials** token (cached and refreshed before expiry) and exposes the
two endpoints Reputo needs:

- `getUsers` / `iterateUsers` — list consented users from `GET /v1/users`,
  paginated via the `x-next` response header.
- `postScores` — submit reputation scores via `POST /v1/clients/scores`.

The package reads no environment variables; the consuming app validates its env
and passes the values to the factory.

## Usage

```ts
import { createDeepIdClient, isValidDid } from '@reputo/deep-id-api';

const client = createDeepIdClient({
  identityBaseUrl: 'https://identity.staging.deep-id.ai',
  appBaseUrl: 'https://app.staging.deep-id.ai',
  clientId: process.env.DEEPID_CLIENT_ID!,
  clientSecret: process.env.DEEPID_CLIENT_SECRET!,
  // scopes defaults to 'api wallets post_scores'
});

// Read consented users (did:sub → { scopes, wallets, scores })
const users = await client.getUsers({ filteredTokenScopes: 'api wallets' });

// Post scores keyed by DID (did:sub or did:plc). DeepID dedups newest-timestamp-wins.
const result = await client.postScores({
  'did:sub:abc123abc123abc123abc123': {
    score: 82,
    type: 'voting_engagement',
    timestamp: '2026-06-12T10:00:00Z',
  },
});
console.log(result.status); // { ok, failed }
```

## Notes

- **Token** is acquired via HTTP Basic Auth (`clientId` / `clientSecret`) and cached
  until `tokenRefreshSkewMs` before expiry. A `401` triggers one refresh + retry.
- **Pagination** cursors expire after 5 minutes — don't pause mid-walk. Use
  `iterateUsers` for large datasets and `getUsers` for the merged map.
- **Identifiers** are posted verbatim; use `isValidDid` to validate the
  `did:(plc|sub):[a-zA-Z0-9]{24}` format before posting.
- **Errors**: transient failures (429, 5xx, network/timeout) are retried with
  exponential backoff + jitter; other 4xx throw `HttpError`. `POST /v1/clients/scores`
  returns `200` even with per-user failures — inspect `status.failed` and `results`.

See the generated API docs (`pnpm --filter @reputo/deep-id-api docs`) and the
DeepID Client API spec for the full contract.
