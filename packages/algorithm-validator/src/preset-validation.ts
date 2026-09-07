import { validateCSVContent } from './csv-validation.js';
import { validateJSONContent } from './json-validation.js';
import { validateCreateAlgorithmPreset } from './schemas/algorithm-preset.js';
import type {
  AlgorithmDefinition,
  AlgorithmPresetValidationResult,
  CsvIoItem,
  JsonIoItem,
  SubAlgorithmIoItem,
} from './types/index.js';
import { validatePayload } from './validation.js';

type FileBackedInput = CsvIoItem | JsonIoItem;
type ResolvedInputContent = File | string | Buffer;
type PresetInput = { key: string; value: unknown };
type PresetData = {
  key: string;
  version: string;
  inputs: PresetInput[];
  name?: string;
  description?: string;
};
type SubAlgorithmEntry = {
  algorithm_key: string;
  algorithm_version: string;
  weight: number;
  inputs: PresetInput[];
};

export interface ResolveInputContentArgs {
  input: FileBackedInput;
  value: unknown;
}

export interface ResolveNestedDefinitionArgs {
  algorithmKey: string;
  algorithmVersion: string;
  childIndex: number;
  parentDefinition: AlgorithmDefinition;
  parentInput: SubAlgorithmIoItem;
}

export interface ValidateAlgorithmPresetArgs {
  definition: AlgorithmDefinition;
  preset: unknown;
  resolveInputContent?: (args: ResolveInputContentArgs) => Promise<ResolvedInputContent | unknown>;
  resolveNestedDefinition?: (args: ResolveNestedDefinitionArgs) => Promise<AlgorithmDefinition | unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPresetInput(value: unknown): value is PresetInput {
  return isRecord(value) && typeof value.key === 'string' && 'value' in value;
}

function isSubAlgorithmEntry(value: unknown): value is SubAlgorithmEntry {
  return (
    isRecord(value) &&
    typeof value.algorithm_key === 'string' &&
    typeof value.algorithm_version === 'string' &&
    typeof value.weight === 'number' &&
    Array.isArray(value.inputs) &&
    value.inputs.every(isPresetInput)
  );
}

function isAlgorithmDefinition(value: unknown): value is AlgorithmDefinition {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    typeof value.name === 'string' &&
    typeof value.category === 'string' &&
    typeof value.summary === 'string' &&
    typeof value.description === 'string' &&
    typeof value.version === 'string' &&
    Array.isArray(value.inputs) &&
    Array.isArray(value.outputs) &&
    typeof value.runtime === 'string'
  );
}

function buildPayload(inputs: Array<{ key: string; value: unknown }>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  for (const input of inputs) {
    payload[input.key] = input.value;
  }

  return payload;
}

function hasBufferSupport(): boolean {
  return typeof Buffer !== 'undefined';
}

function isBufferValue(value: unknown): value is Buffer {
  return hasBufferSupport() && Buffer.isBuffer(value);
}

function isFileValue(value: unknown): value is File {
  return typeof File !== 'undefined' && value instanceof File;
}

async function readResolvedContent(content: ResolvedInputContent): Promise<string> {
  if (typeof content === 'string') {
    return content;
  }

  if (isBufferValue(content)) {
    return content.toString('utf-8');
  }

  return content.text();
}

async function parseResolvedJson(content: ResolvedInputContent): Promise<unknown> {
  return JSON.parse(await readResolvedContent(content));
}

function getFileBackedInputs(definition: AlgorithmDefinition): FileBackedInput[] {
  return definition.inputs.filter((input): input is FileBackedInput => input.type === 'csv' || input.type === 'json');
}

function getSubAlgorithmInputs(definition: AlgorithmDefinition): SubAlgorithmIoItem[] {
  return definition.inputs.filter((input): input is SubAlgorithmIoItem => input.type === 'sub_algorithm');
}

function getUnsupportedInputErrors(params: {
  definition: AlgorithmDefinition;
  inputs: Array<{ key: string; value: unknown }>;
}): NonNullable<AlgorithmPresetValidationResult['errors']> {
  const supportedKeys = new Set(params.definition.inputs.map((input) => input.key));
  const errors: NonNullable<AlgorithmPresetValidationResult['errors']> = [];

  for (const input of params.inputs) {
    if (supportedKeys.has(input.key)) {
      continue;
    }

    errors.push({
      field: input.key,
      message: `Input "${input.key}" is no longer supported by ${params.definition.name}. Create the preset again.`,
      source: 'definition',
    });
  }

  return errors;
}

function getDuplicateInputErrors(
  inputs: Array<{ key: string; value: unknown }>,
): NonNullable<AlgorithmPresetValidationResult['errors']> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const input of inputs) {
    if (seen.has(input.key)) {
      duplicates.add(input.key);
      continue;
    }
    seen.add(input.key);
  }

  return [...duplicates].map((key) => ({
    field: key,
    message: `Input "${key}" can be added only once.`,
    source: 'preset' as const,
  }));
}

function getDefinitionConsistencyErrors(params: {
  definition: AlgorithmDefinition;
  key: string;
  version: string;
}): NonNullable<AlgorithmPresetValidationResult['errors']> {
  const errors: NonNullable<AlgorithmPresetValidationResult['errors']> = [];

  if (params.key !== params.definition.key) {
    errors.push({
      field: 'key',
      message: `The preset must use ${params.definition.name}.`,
      source: 'definition',
    });
  }

  if (params.version !== params.definition.version) {
    errors.push({
      field: 'version',
      message: `The preset must use version ${params.definition.version}.`,
      source: 'definition',
    });
  }

  return errors;
}

async function resolveInputContent(params: {
  input: FileBackedInput;
  value: unknown;
  resolve?: ValidateAlgorithmPresetArgs['resolveInputContent'];
}): Promise<ResolvedInputContent> {
  const resolvedValue =
    typeof params.resolve === 'function'
      ? await params.resolve({ input: params.input, value: params.value })
      : params.value;

  if (typeof resolvedValue === 'string' || isBufferValue(resolvedValue) || isFileValue(resolvedValue)) {
    return resolvedValue;
  }

  throw new Error(`Could not open ${params.input.label ?? params.input.key} for checking.`);
}

function getSelectedChains(selectorValue: unknown, selectorChainField: string): string[] {
  if (!Array.isArray(selectorValue)) {
    return [];
  }

  const chains = new Set<string>();
  for (const item of selectorValue) {
    if (!isRecord(item)) {
      continue;
    }
    const chainValue = item[selectorChainField];
    if (typeof chainValue === 'string' && chainValue.trim() !== '') {
      chains.add(chainValue);
    }
  }

  return [...chains];
}

function runJsonChainCoverageRule(params: {
  definition: AlgorithmDefinition;
  rule: {
    walletInputKey: string;
    selectorInputKey: string;
    selectorChainField: string;
  };
  payload: Record<string, unknown>;
  parsedJsonInputs: Record<string, unknown>;
}): NonNullable<AlgorithmPresetValidationResult['errors']> {
  const walletInput = params.definition.inputs.find(
    (input): input is JsonIoItem => input.key === params.rule.walletInputKey && input.type === 'json',
  );
  if (!walletInput) {
    return [
      {
        field: params.rule.walletInputKey,
        message: `The algorithm definition refers to an unknown JSON input: "${params.rule.walletInputKey}".`,
        source: 'rule',
      },
    ];
  }

  const selectedChains = getSelectedChains(
    params.payload[params.rule.selectorInputKey],
    params.rule.selectorChainField,
  );
  if (selectedChains.length === 0) {
    return [];
  }

  const parsedWalletInput = params.parsedJsonInputs[params.rule.walletInputKey];
  if (!isRecord(parsedWalletInput)) {
    return [];
  }

  const rootKey = walletInput.json?.rootKey ?? 'wallets';
  const walletsByChain = parsedWalletInput[rootKey];
  if (!isRecord(walletsByChain)) {
    return [];
  }

  const missingChains = selectedChains.filter((chain) => {
    const wallets = walletsByChain[chain];
    return !Array.isArray(wallets) || wallets.length === 0;
  });

  if (missingChains.length === 0) {
    return [];
  }

  return [
    {
      field: params.rule.walletInputKey,
      message: `The wallet file has no addresses for these selected blockchains: ${missingChains.join(', ')}.`,
      source: 'rule',
    },
  ];
}

function runDefinitionRules(params: {
  definition: AlgorithmDefinition;
  payload: Record<string, unknown>;
  parsedJsonInputs: Record<string, unknown>;
}): NonNullable<AlgorithmPresetValidationResult['errors']> {
  const rules = params.definition.validation?.rules ?? [];
  const errors: NonNullable<AlgorithmPresetValidationResult['errors']> = [];

  for (const rule of rules) {
    switch (rule.kind) {
      case 'json_chain_coverage':
        errors.push(
          ...runJsonChainCoverageRule({
            definition: params.definition,
            rule,
            payload: params.payload,
            parsedJsonInputs: params.parsedJsonInputs,
          }),
        );
        break;
    }
  }

  return errors;
}

function normalizeErrorMessages(error: unknown): string[] {
  if (error instanceof AggregateError) {
    return error.errors.flatMap((item) => normalizeErrorMessages(item));
  }

  if (isRecord(error) && Array.isArray(error.errors)) {
    const messages = error.errors.filter((value): value is string => typeof value === 'string');
    if (messages.length > 0) {
      return messages;
    }
  }

  if (error instanceof Error) {
    return [error.message];
  }

  return ['Could not check the file. Try again.'];
}

async function validateFileBackedInputs(params: {
  definition: AlgorithmDefinition;
  inputs: PresetInput[];
  payload: Record<string, unknown>;
  resolveInputContent?: ValidateAlgorithmPresetArgs['resolveInputContent'];
}): Promise<{
  errors: NonNullable<AlgorithmPresetValidationResult['errors']>;
  parsedJsonInputs: Record<string, unknown>;
}> {
  const fileErrors: NonNullable<AlgorithmPresetValidationResult['errors']> = [];
  const parsedJsonInputs: Record<string, unknown> = {};

  for (const input of getFileBackedInputs(params.definition)) {
    const presetInput = params.inputs.find((item) => item.key === input.key);
    const inputValue = presetInput?.value ?? params.payload[input.key];
    if (inputValue === undefined || inputValue === null || inputValue === '') {
      continue;
    }

    try {
      const content = await resolveInputContent({
        input,
        value: inputValue,
        resolve: params.resolveInputContent,
      });

      if (input.type === 'csv') {
        const result = await validateCSVContent(content, input.csv);
        if (!result.valid) {
          fileErrors.push(
            ...result.errors.map((message) => ({
              field: input.key,
              message,
              source: 'file' as const,
            })),
          );
        }
      }

      if (input.type === 'json') {
        const result = await validateJSONContent(content, input.json);
        if (!result.valid) {
          fileErrors.push(
            ...result.errors.map((message) => ({
              field: input.key,
              message,
              source: 'file' as const,
            })),
          );
          continue;
        }

        parsedJsonInputs[input.key] = await parseResolvedJson(content);
      }
    } catch (error) {
      fileErrors.push(
        ...normalizeErrorMessages(error).map((message) => ({
          field: input.key,
          message,
          source: 'file' as const,
        })),
      );
    }
  }

  return {
    errors: fileErrors,
    parsedJsonInputs,
  };
}

function prefixNestedField(params: { parentInputKey: string; childIndex: number; field: string }): string {
  if (params.field === '' || params.field === '_preset') {
    return `${params.parentInputKey}.${params.childIndex}`;
  }

  if (params.field === 'key') {
    return `${params.parentInputKey}.${params.childIndex}.algorithm_key`;
  }

  if (params.field === 'version') {
    return `${params.parentInputKey}.${params.childIndex}.algorithm_version`;
  }

  return `${params.parentInputKey}.${params.childIndex}.inputs.${params.field}`;
}

async function resolveNestedDefinition(params: {
  definition: AlgorithmDefinition;
  input: SubAlgorithmIoItem;
  entry: SubAlgorithmEntry;
  childIndex: number;
  resolveNestedDefinition?: ValidateAlgorithmPresetArgs['resolveNestedDefinition'];
}): Promise<{ definition?: AlgorithmDefinition; errors: NonNullable<AlgorithmPresetValidationResult['errors']> }> {
  if (typeof params.resolveNestedDefinition !== 'function') {
    return {
      errors: [
        {
          field: `${params.input.key}.${params.childIndex}.algorithm_key`,
          message: `Could not load ${params.entry.algorithm_key} version ${params.entry.algorithm_version}.`,
          source: 'definition',
        },
      ],
    };
  }

  try {
    const resolved = await params.resolveNestedDefinition({
      algorithmKey: params.entry.algorithm_key,
      algorithmVersion: params.entry.algorithm_version,
      childIndex: params.childIndex,
      parentDefinition: params.definition,
      parentInput: params.input,
    });

    if (!isAlgorithmDefinition(resolved)) {
      return {
        errors: [
          {
            field: `${params.input.key}.${params.childIndex}.algorithm_key`,
            message: `Could not find ${params.entry.algorithm_key} version ${params.entry.algorithm_version}.`,
            source: 'definition',
          },
        ],
      };
    }

    return {
      definition: resolved,
      errors: [],
    };
  } catch (error) {
    return {
      errors: [
        {
          field: `${params.input.key}.${params.childIndex}.algorithm_key`,
          message:
            error instanceof Error
              ? error.message
              : `Could not find ${params.entry.algorithm_key} version ${params.entry.algorithm_version}.`,
          source: 'definition',
        },
      ],
    };
  }
}

async function validateNestedSubAlgorithms(params: {
  definition: AlgorithmDefinition;
  preset: PresetData;
  payload: Record<string, unknown>;
  resolveInputContent?: ValidateAlgorithmPresetArgs['resolveInputContent'];
  resolveNestedDefinition?: ValidateAlgorithmPresetArgs['resolveNestedDefinition'];
}): Promise<NonNullable<AlgorithmPresetValidationResult['errors']>> {
  const errors: NonNullable<AlgorithmPresetValidationResult['errors']> = [];

  for (const input of getSubAlgorithmInputs(params.definition)) {
    const rawEntries = params.payload[input.key];
    if (!Array.isArray(rawEntries)) {
      continue;
    }

    const sharedInputKeys = new Set(input.sharedInputKeys ?? []);
    const sharedInputs = params.preset.inputs.filter((presetInput) => sharedInputKeys.has(presetInput.key));

    for (let childIndex = 0; childIndex < rawEntries.length; childIndex++) {
      const rawEntry = rawEntries[childIndex];
      if (!isSubAlgorithmEntry(rawEntry)) {
        continue;
      }

      const nestedDefinitionResult = await resolveNestedDefinition({
        definition: params.definition,
        input,
        entry: rawEntry,
        childIndex,
        resolveNestedDefinition: params.resolveNestedDefinition,
      });
      errors.push(...nestedDefinitionResult.errors);

      const providedSharedKeys = rawEntry.inputs
        .filter((childInput) => sharedInputKeys.has(childInput.key))
        .map((childInput) => childInput.key);

      for (const sharedInputKey of providedSharedKeys) {
        errors.push({
          field: `${input.key}.${childIndex}.inputs.${sharedInputKey}`,
          message: `Input "${sharedInputKey}" is shared by the combined algorithm. Remove it from this algorithm.`,
          source: 'definition',
        });
      }

      const childDefinition = nestedDefinitionResult.definition;
      if (!childDefinition) {
        continue;
      }

      if (childDefinition.kind === 'combined') {
        errors.push({
          field: `${input.key}.${childIndex}.algorithm_key`,
          message: `${childDefinition.name} cannot be added because it is also a combined algorithm.`,
          source: 'definition',
        });
        continue;
      }

      const childResult = await validateAlgorithmPreset({
        definition: childDefinition,
        preset: {
          key: rawEntry.algorithm_key,
          version: rawEntry.algorithm_version,
          inputs: [...rawEntry.inputs.filter((childInput) => !sharedInputKeys.has(childInput.key)), ...sharedInputs],
        },
        resolveInputContent: params.resolveInputContent,
        resolveNestedDefinition: params.resolveNestedDefinition,
      });

      if (!childResult.success) {
        errors.push(
          ...(childResult.errors ?? []).map((error) => ({
            ...error,
            field: prefixNestedField({
              parentInputKey: input.key,
              childIndex,
              field: error.field,
            }),
          })),
        );
      }
    }
  }

  return errors;
}

export async function validateAlgorithmPreset({
  definition,
  preset,
  resolveInputContent: resolve,
  resolveNestedDefinition: resolveNested,
}: ValidateAlgorithmPresetArgs): Promise<AlgorithmPresetValidationResult> {
  const presetResult = validateCreateAlgorithmPreset(preset);
  if (!presetResult.success) {
    return {
      success: false,
      errors: presetResult.error.issues.map((issue) => ({
        field: issue.path.join('.') || '_preset',
        message: issue.message,
        source: 'preset',
        code: issue.code,
      })),
    };
  }

  const definitionErrors = [
    ...getDefinitionConsistencyErrors({
      definition,
      key: presetResult.data.key,
      version: presetResult.data.version,
    }),
    ...getDuplicateInputErrors(presetResult.data.inputs),
    ...getUnsupportedInputErrors({
      definition,
      inputs: presetResult.data.inputs,
    }),
  ];

  const payload = buildPayload(presetResult.data.inputs);
  const payloadResult = validatePayload(definition, payload);
  const payloadErrors = payloadResult.success
    ? []
    : (payloadResult.errors ?? []).map((error) => ({
        ...error,
        source: 'payload' as const,
      }));

  if (definitionErrors.length > 0 || payloadErrors.length > 0) {
    return {
      success: false,
      errors: [...definitionErrors, ...payloadErrors],
    };
  }

  const validatedPayload = payloadResult.data as Record<string, unknown>;
  const fileValidationResult = await validateFileBackedInputs({
    definition,
    inputs: presetResult.data.inputs,
    payload: validatedPayload,
    resolveInputContent: resolve,
  });

  const ruleErrors = runDefinitionRules({
    definition,
    payload: validatedPayload,
    parsedJsonInputs: fileValidationResult.parsedJsonInputs,
  });

  const nestedErrors = await validateNestedSubAlgorithms({
    definition,
    preset: presetResult.data as PresetData,
    payload: validatedPayload,
    resolveInputContent: resolve,
    resolveNestedDefinition: resolveNested,
  });

  if (fileValidationResult.errors.length > 0 || ruleErrors.length > 0 || nestedErrors.length > 0) {
    return {
      success: false,
      errors: [...fileValidationResult.errors, ...ruleErrors, ...nestedErrors],
    };
  }

  return {
    success: true,
    data: {
      preset: presetResult.data,
      payload: validatedPayload,
    },
  };
}
