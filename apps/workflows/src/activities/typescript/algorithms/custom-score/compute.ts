import { type AlgorithmDefinition, getAlgorithmDefinition } from '@reputo/reputation-algorithms';
import { generateKey, type Storage } from '@reputo/storage';
import { Context } from '@temporalio/activity';

import config from '../../../../config/index.js';
import type { AlgorithmComputeFunction, AlgorithmResult, Snapshot } from '../../../../shared/types/index.js';
import {
  type CustomScoreChild,
  getPrimaryCsvOutput,
  parseCustomScoreChildren,
} from '../../../../shared/utils/index.js';
import { computeContributionScore } from '../contribution-score/compute.js';
import { computeDiscordEngagement } from '../discord-engagement/compute.js';
import { computeGithubEngagement } from '../github-engagement/compute.js';
import { computeMattermostEngagement } from '../mattermost-engagement/compute.js';
import { computeProposalEngagement } from '../proposal-engagement/compute.js';
import { extractOptionalDidsKey } from '../shared/did-input.js';
import { computeTokenValueOverTime } from '../token-value-over-time/compute.js';
import { computeVotingEngagement } from '../voting-engagement/compute.js';

const WEIGHT_PRECISION = 6;

const standaloneRegistry: Record<string, AlgorithmComputeFunction> = {
  voting_engagement: computeVotingEngagement,
  contribution_score: computeContributionScore,
  proposal_engagement: computeProposalEngagement,
  token_value_over_time: computeTokenValueOverTime,
  discord_engagement: computeDiscordEngagement,
  github_engagement: computeGithubEngagement,
  mattermost_engagement: computeMattermostEngagement,
};

const DETAILS_OUTPUT_KEY = 'custom_score_details';

interface ChildSummary {
  algorithm_key: string;
  algorithm_version: string;
  weight: number;
}

/**
 * Configuration-only diagnostics. Per-child observed bounds and lifecycle
 * diagnostics are appended by later run stages; per-user rows never are.
 */
interface CustomScoreDetailsDocument {
  snapshot_id: string;
  total_child_weight: number;
  children: ChildSummary[];
}

function roundWeight(weight: number): number {
  return Math.round(weight * 10 ** WEIGHT_PRECISION) / 10 ** WEIGHT_PRECISION;
}

// Children keep the parent snapshot id: dependency artifacts are stored under it
// (e.g. the run's single deepfunding.db or community_<platform> dataset, shared by
// every child that reads it), and unique child keys keep the output files apart.
function buildChildSnapshot(snapshot: Snapshot, child: CustomScoreChild, didsKey: string | undefined): Snapshot {
  const inputs = child.inputs.filter((input) => input.key !== 'dids');
  return {
    ...snapshot,
    algorithmPresetFrozen: {
      ...snapshot.algorithmPresetFrozen,
      key: child.algorithm_key,
      version: child.algorithm_version,
      inputs: didsKey === undefined ? inputs : [...inputs, { key: 'dids', value: didsKey }],
    },
  };
}

/** Runs one child and returns the S3 key of its native primary CSV artifact. */
async function runChildAlgorithm(input: {
  snapshot: Snapshot;
  storage: Storage;
  didsKey: string | undefined;
  child: CustomScoreChild;
}): Promise<string> {
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

  return childCsvKey;
}

/**
 * Runs every selected child independently and preserves each child's native
 * primary CSV artifact, exposed under the child's own key in `outputs`. There
 * is no plaintext join, weighting, or parent-DID rebuild across children: each
 * child owns its DID namespace, cohort, and zero generation, and its rows are
 * later submitted to DeepID verbatim by the custom raw-score activity.
 */
export async function computeCustomScore(snapshot: Snapshot, storage: Storage): Promise<AlgorithmResult> {
  const ctx = Context.current();
  const logger = ctx.log;
  const snapshotId = snapshot.id;

  logger.info('Starting custom_score', { snapshotId });

  const didsKey = extractOptionalDidsKey(snapshot.algorithmPresetFrozen.inputs);
  const children = parseCustomScoreChildren(snapshot.algorithmPresetFrozen.inputs);
  const totalChildWeight = children.reduce((sum, child) => sum + child.weight, 0);

  logger.info('Resolved custom algorithm inputs', {
    snapshotId,
    childAlgorithmCount: children.length,
    totalChildWeight,
  });

  const outputs: Record<string, string> = {};

  for (let index = 0; index < children.length; index++) {
    ctx.heartbeat({ phase: 'children', processed: index, total: children.length });

    const child = children[index];
    outputs[child.algorithm_key] = await runChildAlgorithm({
      snapshot,
      storage,
      didsKey,
      child,
    });
  }

  const details: CustomScoreDetailsDocument = {
    snapshot_id: snapshotId,
    total_child_weight: roundWeight(totalChildWeight),
    children: children.map((child) => ({
      algorithm_key: child.algorithm_key,
      algorithm_version: child.algorithm_version,
      weight: child.weight,
    })),
  };

  const detailsKey = generateKey('snapshot', snapshotId, 'custom_score_details.json');
  await storage.putObject({
    bucket: config.storage.bucket,
    key: detailsKey,
    body: JSON.stringify(details, null, 2),
    contentType: 'application/json',
  });
  outputs[DETAILS_OUTPUT_KEY] = detailsKey;

  logger.info('Preserved native child outputs', {
    snapshotId,
    outputKeys: Object.keys(outputs),
  });

  return { outputs };
}
