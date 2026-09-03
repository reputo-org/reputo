/** Base path of the community connections controller. */
export const COMMUNITY_CONNECTIONS_ROUTE = 'community/connections';

/**
 * Route GitHub redirects to after an App install. GitHub has no `redirect_uri`
 * parameter for installs — the App's setup URL decides where the admin lands —
 * so the deployment's `GITHUB_APP_CALLBACK_URL` is validated against this path.
 */
export const GITHUB_CALLBACK_ROUTE = 'github/callback';

/** Base path of the community webhook controller — the one community route GitHub itself calls. */
export const COMMUNITY_WEBHOOKS_ROUTE = 'community/webhooks';

/** Path GitHub delivers App webhooks to, appended to `COMMUNITY_WEBHOOKS_ROUTE`. */
export const GITHUB_WEBHOOK_ROUTE = 'github';
