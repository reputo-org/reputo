import { type AlgorithmDefinition, type CsvIoItem, getAlgorithmDefinition } from '@reputo/reputation-algorithms';
import { generateKey, type Storage } from '@reputo/storage';
import { Context } from '@temporalio/activity';
import { parse } from 'csv-parse/sync';

import config from '../../../../config/index.js';
import { HEARTBEAT_INTERVAL } from '../../../../shared/constants/index.js';
import type { AlgorithmComputeFunction, AlgorithmResult, Snapshot } from '../../../../shared/types/index.js';
import { stringifyCsvAsync } from '../../../../shared/utils/index.js';
import { computeContributionScore } from '../contribution-score/compute.js';
import { computeProposalEngagement } from '../proposal-engagement/compute.js';
import { extractDidsKey, getDids, loadDidInputMap } from '../shared/did-input.js';
import { computeTokenValueOverTime } from '../token-value-over-time/compute.js';
import { computeVotingEngagement } from '../voting-engagement/compute.js';

const SCORE_PRECISION = 6;

const standaloneRegistry: Record<string, AlgorithmComputeFunction> = {
  voting_engagement: computeVotingEngagement,
  contribution_score: computeContributionScore,
  proposal_engagement: computeProposalEngagement,
  token_value_over_time: computeTokenValueOverTime,
};

type NormalizationMethod = 'none' | 'min_max' | 'z_score';
type MissingScoreStrategy = 'zero';

interface PresetInputLike {
  key: string;
  value?: unknown;
}

interface SubAlgorithmEntry {
  algorithm_key: string;
  algorithm_version: string;
  weight: number;
  inputs: PresetInputLike[];
}

interface CustomScoreParams {
  didsKey: string;
  subAlgorithms: SubAlgorithmEntry[];
  normalizationMethod: NormalizationMethod;
  missingScoreStrategy: MissingScoreStrategy;
}

interface ChildAlgorithmRuntimeResult {
  entry: SubAlgorithmEntry;
  rawScores: Map<string, number>;
  normalizedScores: Map<string, number>;
}

interface ChildScoreDetail {
  algorithm_key: string;
  algorithm_version: string;
  raw_score: number;
  normalized_score: number;
  child_weight: number;
  weighted_contribution: number;
}

interface CompositeScoreDetail {
  did: string;
  final_composite_score: number;
  child_scores: ChildScoreDetail[];
}

interface CompositeScoreDetailsDocument {
  snapshot_id: string;
  normalization_method: NormalizationMethod;
  missing_score_strategy: MissingScoreStrategy;
  total_child_weight: number;
  dids: CompositeScoreDetail[];
}

function roundScore(score: number): number {
  return Math.round(score * 10 ** SCORE_PRECISION) / 10 ** SCORE_PRECISION;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getRequiredStringInput(inputs: PresetInputLike[], key: string): string {
  const input = inputs.find((entry) => entry.key === key);
  if (input == null || typeof input.value !== 'string' || input.value.trim() === '') {
    throw new Error(`Missing required "${key}" input`);
  }

  return input.value;
}

function parseSubAlgorithmEntry(value: unknown, index: number): SubAlgorithmEntry {
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

function extractInputs(inputs: PresetInputLike[]): CustomScoreParams {
  const didsKey = extractDidsKey(inputs);
  const rawSubAlgorithms = inputs.find((input) => input.key === 'sub_algorithms')?.value;
  if (!Array.isArray(rawSubAlgorithms) || rawSubAlgorithms.length === 0) {
    throw new Error('Missing required "sub_algorithms" input');
  }

  const normalizationMethod = getRequiredStringInput(inputs, 'normalization_method');
  if (normalizationMethod !== 'none' && normalizationMethod !== 'min_max' && normalizationMethod !== 'z_score') {
    throw new Error(`Unsupported normalization_method: ${normalizationMethod}`);
  }

  const missingScoreStrategy = getRequiredStringInput(inputs, 'missing_score_strategy');
  if (missingScoreStrategy !== 'zero') {
    throw new Error(`Unsupported missing_score_strategy: ${missingScoreStrategy}`);
  }

  return {
    didsKey,
    subAlgorithms: rawSubAlgorithms.map(parseSubAlgorithmEntry),
    normalizationMethod,
    missingScoreStrategy,
  };
}

function isCsvOutput(output: unknown): output is CsvIoItem {
  return isRecord(output) && output.type === 'csv' && isRecord(output.csv) && Array.isArray(output.csv.columns);
}

function getPrimaryCsvOutput(definition: AlgorithmDefinition): { outputKey: string; scoreColumnKey: string } {
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

function buildChildSnapshot(
  snapshot: Snapshot,
  child: SubAlgorithmEntry,
  didsKey: string,
  childIndex: number,
): Snapshot {
  return {
    ...snapshot,
    id: `${snapshot.id}__custom_score_child_${childIndex + 1}_${child.algorithm_key}`,
    algorithmPresetFrozen: {
      ...snapshot.algorithmPresetFrozen,
      key: child.algorithm_key,
      version: child.algorithm_version,
      inputs: [...child.inputs.filter((input) => input.key !== 'dids'), { key: 'dids', value: didsKey }],
    },
  };
}

function parseChildScoreCsv(csvText: string, definition: AlgorithmDefinition): Map<string, number> {
  const { scoreColumnKey } = getPrimaryCsvOutput(definition);
  const rows = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Array<Record<string, string>>;

  const scores = new Map<string, number>();

  for (const row of rows) {
    const did = row.did?.trim();
    if (!did) {
      throw new Error(`Algorithm "${definition.key}" output is missing a did value`);
    }

    if (scores.has(did)) {
      throw new Error(`Algorithm "${definition.key}" output contains duplicate did "${did}"`);
    }

    const rawScore = row[scoreColumnKey];
    const score = Number(rawScore);
    if (!Number.isFinite(score)) {
      throw new Error(`Algorithm "${definition.key}" output contains a non-numeric score for "${did}"`);
    }

    scores.set(did, score);
  }

  return scores;
}

function normalizeScoreVector(rawScores: number[], method: NormalizationMethod): number[] {
  if (method === 'none') {
    return rawScores.map((score) => roundScore(score));
  }

  if (rawScores.length === 0) {
    return [];
  }

  if (method === 'min_max') {
    const min = Math.min(...rawScores);
    const max = Math.max(...rawScores);
    if (max === min) {
      return rawScores.map(() => 0);
    }

    return rawScores.map((score) => roundScore((score - min) / (max - min)));
  }

  const mean = rawScores.reduce((sum, score) => sum + score, 0) / rawScores.length;
  const variance = rawScores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / rawScores.length;
  const standardDeviation = Math.sqrt(variance);

  if (standardDeviation === 0) {
    return rawScores.map(() => 0);
  }

  return rawScores.map((score) => roundScore((score - mean) / standardDeviation));
}

async function runChildAlgorithm(input: {
  snapshot: Snapshot;
  storage: Storage;
  dids: string[];
  didsKey: string;
  child: SubAlgorithmEntry;
  childIndex: number;
  normalizationMethod: NormalizationMethod;
}): Promise<ChildAlgorithmRuntimeResult> {
  const childDefinition = JSON.parse(
    getAlgorithmDefinition({
      key: input.child.algorithm_key,
      version: input.child.algorithm_version,
    }),
  ) as AlgorithmDefinition;

  if (childDefinition.kind === 'combined') {
    throw new Error(`Nested combined child algorithm is not supported: ${input.child.algorithm_key}`);
  }

  if (childDefinition.runtime !== 'typescript') {
    throw new Error(
      `Unsupported child algorithm runtime: ${input.child.algorithm_key}@${input.child.algorithm_version}`,
    );
  }

  const compute = standaloneRegistry[input.child.algorithm_key];
  if (!compute) {
    throw new Error(`Unsupported child algorithm: ${input.child.algorithm_key}`);
  }

  const childSnapshot = buildChildSnapshot(input.snapshot, input.child, input.didsKey, input.childIndex);
  const childResult = await compute(childSnapshot, input.storage);
  const { outputKey } = getPrimaryCsvOutput(childDefinition);
  const childCsvKey = childResult.outputs[outputKey];

  if (typeof childCsvKey !== 'string' || childCsvKey.trim() === '') {
    throw new Error(`Child algorithm "${input.child.algorithm_key}" did not return output "${outputKey}"`);
  }

  const childCsvBuffer = await input.storage.getObject({
    bucket: config.storage.bucket,
    key: childCsvKey,
  });

  const parsedScores = parseChildScoreCsv(childCsvBuffer.toString('utf-8'), childDefinition);
  const rawScores = new Map<string, number>();

  for (const did of input.dids) {
    rawScores.set(did, parsedScores.get(did) ?? 0);
  }

  const normalizedVector = normalizeScoreVector(
    input.dids.map((did) => rawScores.get(did) ?? 0),
    input.normalizationMethod,
  );
  const normalizedScores = new Map<string, number>(input.dids.map((did, index) => [did, normalizedVector[index] ?? 0]));

  return {
    entry: input.child,
    rawScores,
    normalizedScores,
  };
}

export async function computeCustomScore(snapshot: Snapshot, storage: Storage): Promise<AlgorithmResult> {
  const ctx = Context.current();
  const logger = ctx.log;
  const snapshotId = snapshot.id;

  logger.info('Starting custom_score', { snapshotId });

  const params = extractInputs(snapshot.algorithmPresetFrozen.inputs);
  const didInputMap = await loadDidInputMap({
    storage,
    bucket: config.storage.bucket,
    key: params.didsKey,
  });
  const dids = getDids(didInputMap);

  logger.info('Resolved custom algorithm inputs', {
    snapshotId,
    didCount: dids.length,
    childAlgorithmCount: params.subAlgorithms.length,
    normalizationMethod: params.normalizationMethod,
    missingScoreStrategy: params.missingScoreStrategy,
  });

  const childResults: ChildAlgorithmRuntimeResult[] = [];

  for (let index = 0; index < params.subAlgorithms.length; index++) {
    if (index % HEARTBEAT_INTERVAL === 0) {
      ctx.heartbeat({ phase: 'children', processed: index, total: params.subAlgorithms.length });
    }

    childResults.push(
      await runChildAlgorithm({
        snapshot,
        storage,
        dids,
        didsKey: params.didsKey,
        child: params.subAlgorithms[index],
        childIndex: index,
        normalizationMethod: params.normalizationMethod,
      }),
    );
  }

  const totalChildWeight = params.subAlgorithms.reduce((sum, child) => sum + child.weight, 0);
  if (totalChildWeight <= 0) {
    throw new Error('Custom algorithm requires a positive total child weight');
  }

  const compositeRows: Array<{ did: string; composite_score: number }> = [];
  const detailsRows: CompositeScoreDetail[] = [];

  for (let index = 0; index < dids.length; index++) {
    if (index % HEARTBEAT_INTERVAL === 0) {
      ctx.heartbeat({ phase: 'combine', processed: index, total: dids.length });
    }

    const did = dids[index];
    const childScores = childResults.map(({ entry, rawScores, normalizedScores }) => {
      const rawScore = rawScores.get(did) ?? 0;
      const normalizedScore = normalizedScores.get(did) ?? 0;
      const weightedContribution = roundScore((normalizedScore * entry.weight) / totalChildWeight);

      return {
        algorithm_key: entry.algorithm_key,
        algorithm_version: entry.algorithm_version,
        raw_score: rawScore,
        normalized_score: normalizedScore,
        child_weight: entry.weight,
        weighted_contribution: weightedContribution,
      };
    });

    const compositeScore = roundScore(
      childScores.reduce((sum, childScore) => sum + childScore.weighted_contribution, 0),
    );

    compositeRows.push({
      did: did,
      composite_score: compositeScore,
    });
    detailsRows.push({
      did: did,
      final_composite_score: compositeScore,
      child_scores: childScores,
    });
  }

  ctx.heartbeat({ phase: 'upload' });

  const compositeCsv = await stringifyCsvAsync(compositeRows, {
    header: true,
    columns: ['did', 'composite_score'],
  });

  const compositeKey = generateKey('snapshot', snapshotId, 'composite_score.csv');
  await storage.putObject({
    bucket: config.storage.bucket,
    key: compositeKey,
    body: compositeCsv,
    contentType: 'text/csv',
  });

  const details: CompositeScoreDetailsDocument = {
    snapshot_id: snapshotId,
    normalization_method: params.normalizationMethod,
    missing_score_strategy: params.missingScoreStrategy,
    total_child_weight: roundScore(totalChildWeight),
    dids: detailsRows,
  };

  const detailsKey = generateKey('snapshot', snapshotId, 'composite_score_details.json');
  await storage.putObject({
    bucket: config.storage.bucket,
    key: detailsKey,
    body: JSON.stringify(details, null, 2),
    contentType: 'application/json',
  });

  logger.info('Uploaded custom algorithm outputs', {
    snapshotId,
    compositeKey,
    detailsKey,
  });

  return {
    outputs: {
      composite_score: compositeKey,
      composite_score_details: detailsKey,
    },
  };
}
