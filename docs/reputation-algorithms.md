# Reputation algorithms

A reputation algorithm calculates a user's reputation score. Each algorithm has two parts:

- **Definition** — a JSON file. It lists the inputs the user must give and the outputs the algorithm returns. The UI uses it to build forms. The API and worker use it to validate inputs.
- **Execution** — a function that runs inside a Temporal activity. It reads the inputs, calculates the score, and writes the outputs.

## Where they live

**Definition** — under [`packages/reputation-algorithms`](../packages/reputation-algorithms). One folder per algorithm key, one JSON file per version:

```text
packages/reputation-algorithms/src/registry/
└── <key>/
    ├── 1.0.0.json
    └── 1.1.0.json
```

**Execution** — under [`apps/workflows`](../apps/workflows). One folder per algorithm with the compute function and any helpers:

```text
apps/workflows/src/activities/typescript/algorithms/<kebab-key>/
├── compute.ts   # exports compute<PascalKey>(snapshot, storage)
└── index.ts     # re-exports compute<PascalKey>
```

### Runtimes

Only TypeScript is wired up today. The workflows app uses Temporal task queues, so other languages can be added later.

## Add a new algorithm

### 1. Scaffold

Pick a `snake_case` key and a semver version, then run:

```bash
pnpm algorithm:create reviewer_quality 1.0.0
```

The script does four things. If any target path already exists, it stops and changes nothing:

1. Creates the JSON file at `packages/reputation-algorithms/src/registry/<key>/<version>.json` from a template.
2. Creates the activity folder at `apps/workflows/src/activities/typescript/algorithms/<kebab-key>/` with `compute.ts` (a function stub) and `index.ts` (an export file).
3. Adds the new compute function to the dispatcher (`dispatchAlgorithm.activity.ts`). The worker uses the dispatcher to find the function by its key.
4. Adds the new function to the `algorithms/index.ts` export list.

### 2. Fill the JSON

Open the new file under `packages/reputation-algorithms/src/registry/`. Required fields:

| Field | Value |
| --- | --- |
| `key` | Must match the folder name (`snake_case`). |
| `name`, `summary`, `description` | Shown in the UI. |
| `kind` | `standalone` or `composite`. |
| `category` | Short tag, e.g. `Activity` or `Voting`. |
| `version`, `runtime` | A semver string. `runtime` is `typescript`. |
| `inputs` | Typed fields the user fills in (`integer`, `number`, `string`, `boolean`, `csv`, `json`). |
| `outputs` | Files the algorithm writes. Each has a `key` and a `type` (`csv` or `json`). |

### 3. Write the compute function

Open the new `compute.ts`. The function must:

- Read frozen inputs from `snapshot.algorithmPresetFrozen.inputs`.
- Download any input files with `storage.getObject(...)`.
- Call `Context.current().heartbeat(...)` inside long loops so Temporal does not time it out.
- Write output files through [`@reputo/storage`](../packages/storage). Do not call the AWS SDK directly.
- Return `{ outputs: { <key>: <storage_key> } }`, with one entry for every `outputs[].key` in the JSON.

### 4. Validate

```bash
pnpm algorithm:validate
```

This checks the JSON file, the matching execution folder, and the generated registry index.

### 5. Test

Add unit tests under `apps/workflows/tests/unit/activities/typescript/algorithms/<kebab-key>/`, then run:

```bash
pnpm --filter @reputo/workflows test
```

### 6. Try it locally

Start the apps (see [Local development](local-development.md)). In the UI, create a preset, start a snapshot, and watch the run at <http://localhost:8088>.
