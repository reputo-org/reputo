# Voting Portal integration

How the Voting Portal connects a user's wallet to Reputo through DeepID consent. The
integration is shared across the Voting Portal, Reputo, and DeepID. Each system has a
separate role and source repository.

## How the consent flow works

1. A user connects a wallet in the Voting Portal. The Portal then shows the Reputo
   consent banner.
2. The Portal opens
   `GET /api/v1/oauth/consent/deep-id?source=voting-portal` on the Reputo API.
3. Reputo creates short-lived, single-use PKCE state. It then sends the browser to
   DeepID's Ory Hydra authorization and consent flow.
4. DeepID signs in the user and shows the requested scopes. The user can grant or deny
   access.
5. DeepID returns the browser to the Reputo callback. Reputo checks and consumes the
   state, exchanges the authorization code, and discards the returned tokens.
6. Reputo returns the browser to the Voting Portal with the result. The Portal uses this result
   to update the consent banner.

## Ownership

- **Reputo API** starts the OAuth flow, protects the temporary PKCE state, handles the
  callback, discards the provider tokens, and returns the result to the Portal.
- **Voting Portal** shows the banner, starts the Reputo flow, handles the callback result,
  and keeps the local display state. 
- **DeepID and Ory Hydra** show the consent screen, store consent sessions, list active
  integrations and scopes, and revoke grants. This functionality already existed in
  DeepID.

## Where consent is stored

DeepID is the permanent source of truth for consent. Ory Hydra stores the consent
session in DeepID's Hydra PostgreSQL database.

Reputo only stores the temporary PKCE transaction in `oauth_consent_grants`. The row is
removed after the callback is used. Reputo does not store the permanent grant or the
tokens returned during this flow.

The Voting Portal stores a local flag for each wallet. This flag only controls the user
interface.

## Viewing and revoking consent

An authenticated DeepID user can open **Settings > Integrations**. The page shows active
applications, granted scopes, creation time, and last access time. Each application has
an action to revoke access.

The DeepID user routes are:

- `GET /api/integrations` — list active integrations and their granted scopes.
- `DELETE /api/integrations/:clientId` — revoke consent for one OAuth client.

DeepID uses Hydra's `/admin/oauth2/auth/sessions/consent` API behind these routes. After
a user revokes access, the application is removed from the active list. The current UI
does not show a history of revoked or denied consent. To change scopes, the user starts
a new OAuth consent flow.