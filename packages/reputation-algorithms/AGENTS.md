# @reputo/reputation-algorithms

A versioned, read-only registry of algorithm *definitions* — JSON Schema documents, Ajv-validated.
It describes algorithms; it never executes them (the compute functions live in `@reputo/workflows`).

It exists as the single source of truth for each algorithm's inputs and outputs: the UI builds forms
from a definition, and the API and workers validate against it. The same API works in Node and the browser.

Public API is `src/index.ts` (`src/api` for lookup); definitions live in `src/registry/<key>/<version>.json`.

`build` runs `registry:validate && registry:build` first, so a malformed definition fails the build.
Scaffold a new algorithm from the repo root with `pnpm algorithm:create <key> <version>` — full guide:
[docs/reputation-algorithms.md](../../docs/reputation-algorithms.md).
