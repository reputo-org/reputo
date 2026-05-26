# @reputo/algorithm-validator

Shared Zod schemas for algorithm payloads and CSV content. Used by the API and the UI to validate user input against an algorithm definition.

## What it exports

- `buildZodSchema(definition)` — build a Zod schema from an algorithm definition.
- `validatePayload(definition, payload)` — validate user input against the schema.
- `validateCSVContent(content)` — CSV checks that work in both Node.js and the browser.
- `createAlgorithmPresetSchema()` and `validateCreateAlgorithmPreset(payload)` — preset payload validation.
- Types: `AlgorithmDefinition`, `CsvIoItem`, `ValidationResult`, `CSVValidationResult`.

## Usage

```ts
import { getAlgorithmDefinition } from '@reputo/reputation-algorithms/api';
import { validatePayload } from '@reputo/algorithm-validator';

const definition = getAlgorithmDefinition('contribution_score', '1.0.0');
const result = validatePayload(definition, userInput);
if (!result.success) {
  console.error(result.errors);
}
```

## Setup

No runtime configuration. The package is framework-agnostic and runs in any TypeScript or JavaScript environment.

## Local commands

```bash
pnpm --filter @reputo/algorithm-validator build
pnpm --filter @reputo/algorithm-validator test
pnpm --filter @reputo/algorithm-validator typecheck
pnpm --filter @reputo/algorithm-validator docs
```

## More

- [Reputation algorithms](../../docs/reputation-algorithms.md)
- Generated API docs: [docs/README.md](docs/README.md)
