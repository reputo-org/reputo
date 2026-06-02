# @reputo/algorithm-validator

Zod-based validation for algorithm payloads, presets, and CSV/JSON file content.

It exists so inputs are checked the same way everywhere: the same schemas run in the browser (UI form
validation) and on the server (API and workflows), with no drift between client and backend rules.

Public API is `src/index.ts`; schemas live in `src/schemas`, validators in `src/*-validation.ts`.
