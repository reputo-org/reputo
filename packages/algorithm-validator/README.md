# @reputo/algorithm-validator

Shared Zod schemas for algorithm payloads and CSV content. Used by the API and the UI to validate user input against an algorithm definition.

## Main exports

- `buildZodSchema(definition)`: build a Zod schema from an algorithm definition.
- `validatePayload(definition, payload)`: validate user input against the schema.
- `validateCSVContent(content)`: CSV checks that work in both Node.js and the browser.
- `createAlgorithmPresetSchema()` and `validateCreateAlgorithmPreset(payload)`: preset payload validation.
- Types: `AlgorithmDefinition`, `CsvIoItem`, `ValidationResult`, `CSVValidationResult`.

## Usage

```ts
import { getAlgorithmDefinition } from '@reputo/reputation-algorithms/api';
import { validatePayload } from '@reputo/algorithm-validator';
import type { AlgorithmDefinition } from '@reputo/reputation-algorithms';

const json = getAlgorithmDefinition({ key: 'contribution_score', version: '1.0.0' });
const definition = JSON.parse(json) as AlgorithmDefinition;
const result = validatePayload(definition, userInput);
if (!result.success) {
  console.error(result.errors);
}
```

## Configuration

No runtime configuration. The package is framework-agnostic and runs in any TypeScript or JavaScript environment.

## Commands

```bash
pnpm --filter @reputo/algorithm-validator build
pnpm --filter @reputo/algorithm-validator test
pnpm --filter @reputo/algorithm-validator typecheck
pnpm --filter @reputo/algorithm-validator docs
```

## Related documentation

- [Reputation algorithms](../../docs/reputation-algorithms.md)
