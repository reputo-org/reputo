import { type AlgorithmDefinition, type CsvIoItem, getAlgorithmDefinition } from '@reputo/reputation-algorithms';
import { generateKey, type Storage } from '@reputo/storage';
import { Context } from '@temporalio/activity';
import { parse } from 'csv-parse/sync';

import config from '../../../../config/index.js';
import { CUSTOM_SCORE_WEIGHTED_COLUMN, HEARTBEAT_INTERVAL } from '../../../../shared/constants/index.js';
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

const DETAILS_OUTPUT_KEY = 'custom_score_details';

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
}

interface ChildAlgorithmRuntimeResult {
  entry: SubAlgorithmEntry;
  rawScores: Map<string, number>;
  weightedScores: Map<string, number>;
}

interface ChildSummary {
  algorithm_key: string;
  algorithm_version: string;
  weight: number;
  weight_share: number;
}

interface ChildScoreDetail {
  algorithm_key: string;
  raw_score: number;
  weighted_score: number;
}

interface DidScoreDetail {
  did: string;
  child_scores: ChildScoreDetail[];
}

interface CustomScoreDetailsDocument {
  snapshot_id: string;
  total_child_weight: number;
  children: ChildSummary[];
  dids: DidScoreDetail[];
}

function roundScore(score: number): number {
  return Math.round(score * 10 ** SCORE_PRECISION) / 10 ** SCORE_PRECISION;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

  const subAlgorithms = rawSubAlgorithms.map(parseSubAlgorithmEntry);

  // Each child posts under its own algorithm key, so one key may appear only once.
  const seenKeys = new Set<string>();
  for (const child of subAlgorithms) {
    if (seenKeys.has(child.algorithm_key)) {
      throw new Error(`Duplicate sub-algorithm "${child.algorithm_key}": each sub-algorithm can be added only once`);
    }
    seenKeys.add(child.algorithm_key);
  }

  return { didsKey, subAlgorithms };
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

// Children keep the parent snapshot id: dependency artifacts are stored under it
// (e.g. the run's single deepfunding.db, shared by every portal child), and unique
// child keys keep the per-child output files apart.
function buildChildSnapshot(snapshot: Snapshot, child: SubAlgorithmEntry, didsKey: string): Snapshot {
  return {
    ...snapshot,
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

async function runChildAlgorithm(input: {
  snapshot: Snapshot;
  storage: Storage;
  dids: string[];
  didsKey: string;
  child: SubAlgorithmEntry;
  weightShare: number;
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

  const childSnapshot = buildChildSnapshot(input.snapshot, input.child, input.didsKey);
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

  // Each standalone algorithm already normalizes its output into the canonical
  // 0–100 range, so the weights apply to the normalized scores directly. Users
  // absent from a child's output get an explicit 0.
  const rawScores = new Map<string, number>();
  const weightedScores = new Map<string, number>();
  for (const did of input.dids) {
    const rawScore = parsedScores.get(did) ?? 0;
    rawScores.set(did, rawScore);
    weightedScores.set(did, roundScore(rawScore * input.weightShare));
  }

  return {
    entry: input.child,
    rawScores,
    weightedScores,
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
  const totalChildWeight = params.subAlgorithms.reduce((sum, child) => sum + child.weight, 0);

  logger.info('Resolved custom algorithm inputs', {
    snapshotId,
    didCount: dids.length,
    childAlgorithmCount: params.subAlgorithms.length,
    totalChildWeight,
  });

  const childResults: ChildAlgorithmRuntimeResult[] = [];

  for (let index = 0; index < params.subAlgorithms.length; index++) {
    ctx.heartbeat({ phase: 'children', processed: index, total: params.subAlgorithms.length });

    const child = params.subAlgorithms[index];
    childResults.push(
      await runChildAlgorithm({
        snapshot,
        storage,
        dids,
        didsKey: params.didsKey,
        child,
        weightShare: child.weight / totalChildWeight,
      }),
    );
  }

  const outputs: Record<string, string> = {};

  for (let index = 0; index < childResults.length; index++) {
    ctx.heartbeat({ phase: 'upload', processed: index, total: childResults.length });

    const { entry, weightedScores } = childResults[index];
    const weightedCsv = await stringifyCsvAsync(
      dids.map((did) => ({ did, [CUSTOM_SCORE_WEIGHTED_COLUMN]: weightedScores.get(did) ?? 0 })),
      {
        header: true,
        columns: ['did', CUSTOM_SCORE_WEIGHTED_COLUMN],
      },
    );

    const weightedCsvKey = generateKey('snapshot', snapshotId, `${entry.algorithm_key}_weighted_score.csv`);
    await storage.putObject({
      bucket: config.storage.bucket,
      key: weightedCsvKey,
      body: weightedCsv,
      contentType: 'text/csv',
    });

    outputs[entry.algorithm_key] = weightedCsvKey;
  }

  const detailsRows: DidScoreDetail[] = [];
  for (let index = 0; index < dids.length; index++) {
    if (index % HEARTBEAT_INTERVAL === 0) {
      ctx.heartbeat({ phase: 'details', processed: index, total: dids.length });
    }

    const did = dids[index];
    detailsRows.push({
      did,
      child_scores: childResults.map(({ entry, rawScores, weightedScores }) => ({
        algorithm_key: entry.algorithm_key,
        raw_score: rawScores.get(did) ?? 0,
        weighted_score: weightedScores.get(did) ?? 0,
      })),
    });
  }

  const details: CustomScoreDetailsDocument = {
    snapshot_id: snapshotId,
    total_child_weight: roundScore(totalChildWeight),
    children: params.subAlgorithms.map((child) => ({
      algorithm_key: child.algorithm_key,
      algorithm_version: child.algorithm_version,
      weight: child.weight,
      weight_share: roundScore(child.weight / totalChildWeight),
    })),
    dids: detailsRows,
  };

  const detailsKey = generateKey('snapshot', snapshotId, 'custom_score_details.json');
  await storage.putObject({
    bucket: config.storage.bucket,
    key: detailsKey,
    body: JSON.stringify(details, null, 2),
    contentType: 'application/json',
  });
  outputs[DETAILS_OUTPUT_KEY] = detailsKey;

  logger.info('Uploaded custom algorithm outputs', {
    snapshotId,
    outputKeys: Object.keys(outputs),
  });

  return { outputs };
}
