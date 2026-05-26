# @reputo/reputation-algorithms

Read-only registry of versioned algorithm definitions. Used by the UI, the API, and the workflow workers to discover algorithms and render their input forms.

## What it exports

- **Root entry** (`@reputo/reputation-algorithms`): algorithm definition types and registry errors.
- **API entry** (`@reputo/reputation-algorithms/api`):
  - `getAlgorithmDefinitionKeys()`
  - `getAlgorithmDefinitionVersions(key)`
  - `getAlgorithmDefinition(key, version)`
  - `searchAlgorithmDefinitions(query)`
- The registry JSON files under `src/registry/`.
- The generated registry index at `src/registry/index.gen.ts`.

## Usage

```ts
import { getAlgorithmDefinition } from '@reputo/reputation-algorithms/api';

const def = getAlgorithmDefinition('contribution_score', '1.0.0');
console.log(def.name, def.inputs.length);
```

## Setup

No runtime configuration. The registry index is generated at build time:

```bash
pnpm --filter @reputo/reputation-algorithms build
```

## Add a new algorithm

Use the scaffolding script at the repo root:

```bash
pnpm algorithm:create <key> <version>
```

This creates the JSON definition here **and** the matching compute scaffold in [`apps/workflows`](../../apps/workflows). See [Reputation algorithms](../../docs/reputation-algorithms.md) for the full workflow.

## Local commands

```bash
pnpm --filter @reputo/reputation-algorithms build
pnpm --filter @reputo/reputation-algorithms test
pnpm --filter @reputo/reputation-algorithms typecheck
pnpm --filter @reputo/reputation-algorithms registry:validate
pnpm --filter @reputo/reputation-algorithms registry:build
pnpm --filter @reputo/reputation-algorithms docs
```

## More

- [Reputation algorithms](../../docs/reputation-algorithms.md)
- Generated API docs: [docs/README.md](docs/README.md)
