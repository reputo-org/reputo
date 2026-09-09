# Community runbook

What to do when a community connection, snapshot, or publication misbehaves. Status words are the ones the UI shows. See [Community connections](community-connections.md) for how the status model works.

## Connections

| Symptom | Cause | What to do |
| --- | --- | --- |
| Row shows **Action needed** | The bot was removed, its token was revoked, the App was uninstalled or suspended, or no resource is readable. The reason box under the row names it. | Fix it on the platform, then **Reconnect**. Reconnecting revives the same row. |
| Row shows **Temporary issue** | A rate limit, a network error, or a platform error during the last check. | Wait a few minutes, then **Check again**. |
| Row stays **Checking** | The first probe has not finished. | Check the API logs for the probe error. |
| "n of m channels available" | The bot cannot read some resources. The preset picker lists them under **No access** with the reason: Can't view, No history (Discord), Issues off (GitHub), Not a member (Mattermost). | Grant the permission on the platform. The row updates by itself. |
| A change on the platform does not show up | Two cases reach no feed: a role added to or removed from the Discord bot itself, and a GitHub delivery lost while the API was down. A new Mattermost channel created by another user is not pushed to the bot either. | **Check again**. |
| A GitHub row is stuck on **Action needed** after a reinstall | GitHub mints a new installation id on every reinstall. The old row is orphaned and the reconnect created a new one. | Disconnect the old row. |
| GitHub changes never arrive | Webhook misconfigured. | Open the App's **Advanced > Recent Deliveries**. `401`: the secret differs from `GITHUB_APP_WEBHOOK_SECRET`. Connection error: the URL is wrong or not reachable. No deliveries: the events are not subscribed. |
| Mattermost connect fails with "token rejected" or "not a member of any team" | The token is invalid, or the bot is in no team. | Create a new token, add the bot to the team, connect again. |
| Mattermost connect fails with a policy error | The server is not public HTTPS, or resolves to a private address. | Use a public HTTPS server, or add the host to `COMMUNITY_MATTERMOST_ALLOWED_HOSTS` if it is intentionally internal. |

## Presets and snapshots

| Symptom | Cause | What to do |
| --- | --- | --- |
| Preset save or snapshot start is rejected, naming a resource | The bot cannot read that channel or repository. | Grant access, or use **Remove unreadable** in the picker. |
| Composer says "Connect a … community first" | No **Connected** connection for that platform. | Connect one on the Communities page. |
| Snapshot **Failed** during the fetch | The connection broke during the run. The row is re-checked and moves to **Action needed**. | Fix the connection, run the snapshot again. |
| Snapshot completed, but some resources are missing | Partial coverage: the resource became unreadable after progress was made. | See `coverage` in the details JSON. Fix access, run again. |
| Community snapshots stay **Queued** | Only one community fetch runs at a time. | Wait, or look at the running one in the Temporal UI. |
| Every user scored `0` | Users are not matched: no consent, no linked account, or a renamed username. | Check `cohort` counts in the details JSON. Users must link the account in DeepID with the same username. |

## Publication to DeepID

| Symptom | Cause | What to do |
| --- | --- | --- |
| **Failed** with an unknown score type | DeepID has not registered `discord_engagement`, `github_engagement`, or `mattermost_engagement`. | Ask DeepID. Run the snapshot again afterwards. Posting twice is safe. |
| Snapshot fails in `resolveDependency` with `400 Invalid filters` | DeepID rejects a scope in `DEEP_ID_SCOPES` as a filter. | Remove the scope, or ask DeepID to register it. |
| Snapshot fails with `400 Invalid pageSize` | `DEEP_ID_USERS_PAGE_SIZE` above 100. | Set it to 100 or below. |
| Many users "without consent" | Expected. DeepID rejects users who did not consent to Reputo. | Nothing, unless the number is wrong. Then check consent scopes. |
| Custom Score stays **Running** for hours | DeepID is still encrypting child scores. The run waits up to 24 hours. | Wait. `DEEPID_ENCRYPTION_TIMEOUT` means the deadline passed: check DeepID's encryption workers, then start a new snapshot. |

## Keys and secrets

- Rotate the Mattermost sealing key as described in [Community platform setup](community-platform-setup.md#mattermost). Never clear the previous key before every connection has reconnected once.
- `GITHUB_APP_WEBHOOK_SECRET` must equal the secret on the App's webhook. Change both together.
- A new Discord bot token needs a redeploy. Existing connections keep working after it.

## Where to look

| Question | Place |
| --- | --- |
| What happened to a connection | `community_connection_audit`: every human action and every status transition, with the failure category. |
| Why a snapshot failed | The **Details** dialog of the snapshot, and the workflow in the Temporal UI. |
| What was posted to DeepID | The **DeepID publication** section of the snapshot details, and `snapshot_publications`. |
| Worker and API logs | Grafana, Loki data source, `{service="api"}` or `{service="community-worker"}`. See [Observability](observability.md). |
