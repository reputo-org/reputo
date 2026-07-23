import type { AlgorithmDefinition, CsvIoItem } from '@reputo/reputation-algorithms';

/** One selected child of a `custom_score` preset, as frozen in `sub_algorithms`. */
export interface CustomScoreChild {
  algorithm_key: string;
  algorithm_version: string;
  weight: number;
  inputs: Array<{ key: string; value?: unknown }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseChildEntry(value: unknown, index: number): CustomScoreChild {
  if (!isRecord(value)) {
    throw new Error(`Invalid sub-algorithm entry at index ${index}`);
  }

  const algorithmKey = value.algorithm_key;
  const algorithmVersion = value.algorithm_version;
  const weight = value.weight;
  const inputs = value.inputs;

  if (typeof algorithmKey !== 'string' || algorithmKey.trim() === '') {
    throw new Error(`Missing required sub_algorithms.${index}.algorithm_key`);
  }

  if (typeof algorithmVersion !== 'string' || algorithmVersion.trim() === '') {
    throw new Error(`Missing required sub_algorithms.${index}.algorithm_version`);
  }

  if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) {
    throw new Error(`Invalid sub_algorithms.${index}.weight`);
  }

  if (!Array.isArray(inputs) || !inputs.every((input) => isRecord(input) && typeof input.key === 'string')) {
    throw new Error(`Invalid sub_algorithms.${index}.inputs`);
  }

  return {
    algorithm_key: algorithmKey,
    algorithm_version: algorithmVersion,
    weight,
    inputs: inputs.map((input) => ({
      key: String(input.key),
      value: input.value,
    })),
  };
}

/**
 * Parses and validates the `sub_algorithms` preset input shared by the
 * custom-score compute and submission paths: unique children, finite positive
 * weights, and a finite total weight.
 */
export function parseCustomScoreChildren(inputs: Array<{ key: string; value?: unknown }>): CustomScoreChild[] {
  const rawSubAlgorithms = inputs.find((input) => input.key === 'sub_algorithms')?.value;
  if (!Array.isArray(rawSubAlgorithms) || rawSubAlgorithms.length === 0) {
    throw new Error('Missing required "sub_algorithms" input');
  }

  const children = rawSubAlgorithms.map(parseChildEntry);

  // Each child posts under its own algorithm key, so one key may appear only once.
  const seenKeys = new Set<string>();
  for (const child of children) {
    if (seenKeys.has(child.algorithm_key)) {
      throw new Error(`Duplicate sub-algorithm "${child.algorithm_key}": each sub-algorithm can be added only once`);
    }
    seenKeys.add(child.algorithm_key);
  }

  // Entry weights are positive, but the aggregation divides by their sum,
  // which can still overflow to Infinity.
  const totalWeight = children.reduce((sum, child) => sum + child.weight, 0);
  if (!Number.isFinite(totalWeight)) {
    throw new Error('Invalid sub_algorithms weights: the total weight must be finite');
  }

  return children;
}

function isCsvOutput(output: unknown): output is CsvIoItem {
  return isRecord(output) && output.type === 'csv' && isRecord(output.csv) && Array.isArray(output.csv.columns);
}

/**
 * The primary score CSV of an algorithm definition: its first CSV output,
 * which must have a `did` column plus one score column.
 */
export function getPrimaryCsvOutput(definition: AlgorithmDefinition): { outputKey: string; scoreColumnKey: string } {
  const csvOutput = definition.outputs.find(isCsvOutput);
  if (!csvOutput) {
    throw new Error(`Algorithm "${definition.key}" does not define a CSV output`);
  }

  const hasDidColumn = csvOutput.csv.columns.some((column) => column.key === 'did');
  if (!hasDidColumn) {
    throw new Error(`Algorithm "${definition.key}" CSV output must contain a "did" column`);
  }

  const scoreColumn = csvOutput.csv.columns.find((column) => column.key !== 'did');
  if (!scoreColumn) {
    throw new Error(`Algorithm "${definition.key}" CSV output must contain a score column`);
  }

  return {
    outputKey: csvOutput.key,
    scoreColumnKey: scoreColumn.key,
  };
}
