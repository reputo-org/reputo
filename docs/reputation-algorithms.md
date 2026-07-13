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

## Score normalization

Every algorithm's final per-user score is normalized to a fixed **0–100** range before it is written to the CSV output (the value the `custom_score` wrapper, the DeepID post step, and the UI read). This is a default; it is not user-configurable.

The reusable logic lives in [`shared/normalization`](../apps/workflows/src/activities/typescript/algorithms/shared/normalization). Each algorithm picks a method and calls `normalizeScores(values, method)`:

| Method | Behavior | Used by |
| --- | --- | --- |
| `min_max` | Cohort min–max: the lowest score maps to 0, the highest to 100, the rest interpolate. Scores are **relative to the scored population**. An empty, single-member, or all-equal cohort has no spread, so every score collapses to 0. | `contribution_score`, `proposal_engagement`, `token_value_over_time` |
| `from_unit_interval` | Linear rescale of a score already on `[0, 1]` onto 0–100 (×100). Keeps its absolute meaning and comparability across snapshots. | `voting_engagement` |

`custom_score` does not normalize again: each sub-algorithm normalizes its own output to 0–100 first. The wrapper then only scales each sub-algorithm's score by `weight ÷ total weight` and writes one weighted CSV per sub-algorithm — it does not combine them into one score. Each weighted score stays within 0–100, and the sum of one user's weighted scores across all sub-algorithms also stays within 0–100 (the aggregation itself happens later, outside the algorithm). Add a new method by implementing a `NormalizationStrategy` and registering it in `normalize.ts` — no call site changes.

The `*_details.json` benchmark files keep the **raw, pre-normalization** scores; only the CSV output is normalized.

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
- Normalize the final per-user scores to 0–100 with `normalizeScores(...)` (see [Score normalization](#score-normalization)) before writing the CSV.
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
