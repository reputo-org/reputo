# UI Instructions

- Use Next App Router patterns. Default to Server Components and add `"use client"` only for state, effects, or browser-only APIs.
- Keep route files such as `page.tsx` and `layout.tsx` thin; move reusable UI into `src/components`, reusable client state into `src/hooks`, API access into `src/lib/api`, and algorithm/form logic into `src/core`.
- Do not leak server-only concerns into browser code.
- Respect the local `/api` rewrite pattern in `next.config.ts`; do not hardcode alternate internal API hosts in UI code.
- When behavior changes, keep the affected flow testable and add coverage where the repo already has a testing seam.
