# @reputo/ui

Next.js (App Router) dashboard — the human surface over the API. Users browse algorithms, create
presets, launch snapshots, and follow snapshot progress.

It renders with Server Components by default (`"use client"` only for state, effects, or browser APIs).
Route files in `src/app` stay thin; reusable UI is in `src/components`, client state in `src/hooks`,
algorithm/form logic in `src/core`, API access and env in `src/lib` (`src/lib/env.ts`). It calls the
backend over same-origin `/api/v1` (a rewrite in `next.config.ts`) and follows snapshot status over SSE,
so it never hardcodes an API host — set `API_PROXY_TARGET` when the API is not at the default address.
Algorithm definitions come from `@reputo/reputation-algorithms`.

## How to run and test

```bash
pnpm --filter @reputo/ui dev     # build deps, then Next.js on :4000 (turbopack)
pnpm --filter @reputo/ui test    # Vitest
pnpm --filter @reputo/ui build   # standalone Next.js server build
```
