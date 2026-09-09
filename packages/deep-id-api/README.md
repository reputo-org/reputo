# @reputo/deep-id-api

Framework-agnostic client for the DeepID Client API, used by Reputo as a machine-to-machine integration. It manages the client-credentials token (cached and refreshed before expiry) and exposes the endpoints Reputo needs. It reads no environment variables.

## Main exports

- `createDeepIdClient(config)`: the client.
- `getUsers` / `iterateUsers`: consented users from `GET /v1/users`, paginated through the `x-next` header. Page size 100 by default, which is DeepID's maximum. Cursors expire after 5 minutes.
- `postScores`: plaintext scores or encrypted `custom_score_encr` entries through `POST /v1/clients/scores`.
- `getSealMetadata`: the public CKKS parameters a user's `scores_encr` references.
- `parseSocialIdentity`, `SOCIAL_IDENTITY_SCOPES`: the linked `github`, `discord`, and `mattermost` accounts.
- `parseEncryptedScores`, `ENCRYPTED_SCORE_SCOPES`, `isValidDid`, the Zod schemas, `HttpError`, `DeepIdContractError`.

## Usage

```ts
import { createDeepIdClient, parseSocialIdentity } from '@reputo/deep-id-api';

const client = createDeepIdClient({ identityBaseUrl, appBaseUrl, clientId, clientSecret });

for await (const page of client.iterateUsers({ filteredTokenScopes: 'api discord' })) {
  for (const [did, user] of Object.entries(page.users)) {
    const discord = parseSocialIdentity(user.discord); // null when unlinked
  }
}

await client.postScores({
  'did:sub:abc123abc123abc123abc123': { score: 82, type: 'voting_engagement', timestamp: runTimestamp },
});
```

## Rules

- **Identities**: DIDs are posted as given. Validate with `isValidDid` (`did:(plc|sub):` plus 24 alphanumerics). A score of `0` is a valid score.
- **Social identities**: the platform field is `null` when nothing is linked and absent when the scope is outside the token or consent. `username` is the only join key. Never log `vc`.
- **Encrypted scores**: a child field is `absent`, `pending_encryption`, or `encrypted`. An entry is either `score` or `ciphertext` plus `keyId`, never both. Contract violations throw `DeepIdContractError`, which is never retryable and never carries scores, ciphertexts, or tokens.
- **Idempotency**: DeepID dedups on the same entry and run timestamp. Resend identical payloads with the same timestamp; the client never changes timestamps.
- **Errors**: 429, 5xx, and network failures retry with backoff. Other 4xx throw `HttpError` with a body snippet. `postScores` returns `200` even with per-user failures: read `status.failed` and `results`. Quote `requestId` when reporting problems.

## Commands

```bash
pnpm --filter @reputo/deep-id-api build
pnpm --filter @reputo/deep-id-api test
pnpm --filter @reputo/deep-id-api typecheck
pnpm --filter @reputo/deep-id-api docs
```

## Related documentation

- [DeepID integration](../../docs/deep-id-integration.md)
