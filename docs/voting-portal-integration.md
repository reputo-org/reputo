# Voting Portal integration

How a Voting Portal user gives Reputo consent through DeepID. DeepID owns the consent: the screen, the storage, the management page, and revocation. Reputo only runs the OAuth flow between the Portal and DeepID.

## The consent flow

1. The user connects a wallet in the Voting Portal. The Portal shows the Reputo consent banner.
2. The Portal opens `GET /api/v1/oauth/consent/deep-id?source=voting-portal` on the Reputo API.
3. Reputo creates short-lived, single-use PKCE state and sends the browser to DeepID's authorization and consent screen.
4. DeepID signs in the user and lists the requested scopes. The user grants or denies.
5. DeepID returns the browser to the Reputo callback. Reputo checks and consumes the state, exchanges the code, and discards the tokens.
6. Reputo returns the browser to the Portal with the result. The Portal updates its banner.

The requested scopes are the value of `DEEP_ID_CONSENT_SCOPES`. See [DeepID integration](deep-id-integration.md#scopes) for the list and what each scope allows.

## Who stores what

| Party | Stores |
| --- | --- |
| DeepID (Ory Hydra) | The consent session. The permanent source of truth. |
| Reputo | Only the temporary PKCE transaction in `oauth_consent_grants`, removed after the callback. No grant, no tokens. |
| Voting Portal | A local flag per wallet that only controls its UI. |

## View or revoke consent

A DeepID user opens **Settings > Integrations** in DeepID. The page lists active applications, their scopes, creation time, and last access, with a revoke action per application. After revoking, the application disappears from the list. To change scopes, the user runs the consent flow again.

DeepID exposes these routes to its users:

- `GET /api/integrations` lists active integrations and scopes.
- `DELETE /api/integrations/:clientId` revokes consent for one client.
