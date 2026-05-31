# @reputo/ui

Next.js dashboard for the Reputo platform. Browse algorithms, create presets, launch snapshots, and follow snapshot progress.

## What it does

- Redirects `/` to `/dashboard`.
- Loads algorithm definitions from [`@reputo/reputation-algorithms`](../../packages/reputation-algorithms).
- Calls the backend through same-origin `/api/v1` requests.
- Listens to snapshot status changes over Server-Sent Events.
- Builds as a standalone Next.js server for container runtime.

## Local commands

```bash
pnpm --filter @reputo/ui dev           # build deps, then start Next.js on :4000
pnpm --filter @reputo/ui build
pnpm --filter @reputo/ui start
pnpm --filter @reputo/ui test
pnpm --filter @reputo/ui typecheck
```

Local development listens on <http://localhost:4000>.

## Configuration

The UI validates its environment in [`src/lib/env.ts`](src/lib/env.ts). Most variables are optional in development.

If you run the API on a non-standard host, set `API_PROXY_TARGET` in your root `.env` so Next.js rewrites `/api/*` to the right address. Behind Traefik (the Docker stack), keep `API_PROXY_TARGET` unset — the UI uses same-origin `/api/*`.

## More

- [Documentation](../../docs/README.md)
- [Local development](../../docs/local-development.md)
