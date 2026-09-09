# Reputation algorithms

What an algorithm is, which ones exist, and how to add one.

## Two parts

- **Definition**: a JSON file in [`packages/reputation-algorithms/src/registry/<key>/<version>.json`](../packages/reputation-algorithms/src/registry). It lists the inputs, outputs, and data dependencies. The UI builds the preset form from it. The API and workers validate against it.
- **Execution**: a compute function in [`apps/workflows/src/activities/typescript/algorithms/<kebab-key>/compute.ts`](../apps/workflows/src/activities/typescript/algorithms). It reads the frozen inputs, resolves the data, and writes the outputs to object storage.

Only the TypeScript runtime exists today.

## The algorithms

| Key | Data | Raw score |
| --- | --- | --- |
| `contribution_score` | Deep Funding Portal comments and votes | Sum of scored comment values. |
| `proposal_engagement` | Deep Funding Portal proposals and ratings | Rewards minus penalties. Can be negative. |
| `voting_engagement` | Consented DeepID users plus two uploaded CSVs | 0 to 1. |
| `token_value_over_time` | Consented DeepID users plus on-chain transfers | Sum of matured token value. |
| `discord_engagement`, `github_engagement`, `mattermost_engagement` | Consented DeepID users plus a connected community | Sum of points, 0 or more. See [Community algorithms](community-algorithms.md). |
| `custom_score` | The results of the selected algorithms | A weighted average of scores adjusted to 0–100, computed on encrypted values. |

Standalone algorithms write the **raw** score. No normalization, rescaling, or weighting happens in an algorithm. The CSV, the details JSON, and the score posted to DeepID carry the same number. Normalization exists in one place: the encrypted `custom_score` phase. See [DeepID integration](deep-id-integration.md).

## Add a standalone algorithm

1. **Scaffold.** `pnpm algorithm:create <snake_case_key> 1.0.0` creates the JSON, the compute folder, the dispatcher entry, and the barrel export. It stops if any target exists.
2. **Fill the JSON.** `key` (matches the folder), `name`, `summary`, `description` (Markdown, shown in the UI), `kind` (`standalone` or `combined`), `category`, `version`, `runtime`, `inputs`, `outputs`, `dependencies`.
3. **Write the compute function.** Read `snapshot.algorithmPresetFrozen.inputs`, download files with `storage.getObject`, call `Context.current().heartbeat()` in long loops, write outputs through `@reputo/storage`, and return `{ outputs: { <key>: <storageKey> } }` with one entry per output.
4. **Wire the UI.** Add the input keys to the group map in [`apps/ui/src/core/preset-groups.ts`](../apps/ui/src/core/preset-groups.ts) and, for a new dependency key, a label in `apps/ui/src/core/algorithms.ts`.
5. **Validate and test.** `pnpm algorithm:validate`, then unit tests under `apps/workflows/tests/unit/activities/typescript/algorithms/<kebab-key>/` and `pnpm --filter @reputo/workflows test`.
6. **Try it.** Start the apps, create a preset, run a snapshot, watch it at <http://localhost:8088>.

Input types are `integer`, `number`, `string`, `boolean`, `csv`, `json`, `array`, and `sub_algorithm`. Widgets come from `uiHint.widget`: `slider`, `number`, `select`, `repeater`, `resource_selector`, `community_connection`, `community_resources`, `sub_algorithm_composer`.

For a new community platform, follow [Adding a community platform](adding-a-community-platform.md) instead.
