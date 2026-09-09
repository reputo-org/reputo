# @reputo/ui

Next.js dashboard for Reputo.

## What it does

| Page | Purpose |
| --- | --- |
| `/dashboard` | Browse the algorithms. Each algorithm has Description, Presets, and Snapshots tabs. |
| `/dashboard/algorithms/<key>/presets/new`, `.../edit` | The preset composer. |
| `/community` | Connect Discord, GitHub, and Mattermost and follow the connection status live. |
| `/admins` | Manage who can sign in (owners only). |
| `/guides` | The Scribe walkthroughs. |

- Loads algorithm definitions from [`@reputo/reputation-algorithms`](../../packages/reputation-algorithms).
- Calls the API through same-origin `/api/v1` requests and follows snapshot and connection changes over Server-Sent Events.
- Builds as a standalone Next.js server for the container runtime.

## Run locally

```bash
pnpm --filter @reputo/ui dev           # build deps, then start Next.js on :4000
pnpm --filter @reputo/ui build
pnpm --filter @reputo/ui start
pnpm --filter @reputo/ui test
pnpm --filter @reputo/ui typecheck
```

## Configuration

The UI validates its environment in [`src/lib/env.ts`](src/lib/env.ts). Most variables are optional in development. If the API runs on a non-standard host, set `API_PROXY_TARGET` in the root `.env`. Behind Traefik, leave it unset.

## Related documentation

- [Documentation](../../docs/README.md)
- [Guides](../../docs/guides.md)
