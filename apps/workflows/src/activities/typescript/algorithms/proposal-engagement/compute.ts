import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';

import { closeDbInstance, createDb, createRepos } from '@reputo/deepfunding-portal-api';
import { generateKey, type Storage } from '@reputo/storage';
import { Context } from '@temporalio/activity';

import config from '../../../../config/index.js';
import { HEARTBEAT_INTERVAL } from '../../../../shared/constants/index.js';
import type { AlgorithmResult, Snapshot } from '../../../../shared/types/index.js';
import { stringifyCsvAsync } from '../../../../shared/utils/index.js';
import { buildDeepProposalPortalSubIdsIndex, getSubIds, loadSubIdInputMap } from '../shared/sub-id-input.js';
import { buildProposalBenchmarkRecord, formatBenchmarkOutput } from './benchmark/index.js';
import {
  aggregateCommunityRatings,
  classifyProposal,
  computeCommunityScore,
  computeProposalScore,
  computeTimeWeightFromString,
} from './pipeline/index.js';
import type { ProposalBenchmarkRecord, ProposalEngagementResult } from './types.js';
import { roundScore } from './types.js';
import { buildProposalOwners, createDeepFundingDb, extractInputs } from './utils/index.js';

interface UserScoreAccumulator {
  positiveSum: number;
  negativeSum: number;
}

export async function computeProposalEngagement(snapshot: Snapshot, storage: Storage): Promise<AlgorithmResult> {
  const ctx = Context.current();
  const logger = ctx.log;
  const snapshotId = snapshot.id;
  const now = new Date();

  const inputs = extractInputs(snapshot.algorithmPresetFrozen.inputs);
  const subIdInputMap = await loadSubIdInputMap({
    storage,
    bucket: config.storage.bucket,
    key: inputs.subIdsKey,
  });
  const subIds = getSubIds(subIdInputMap);
  const deepProposalPortalSubIdsIndex = buildDeepProposalPortalSubIdsIndex(subIdInputMap);
  const deepProposalPortalIdBySubId = new Map(
    subIds.map((subId) => [subId, subIdInputMap.subIds[subId]?.deepProposalPortalId ?? null]),
  );
  const dbPath = await createDeepFundingDb(snapshotId, storage);
  const db = await createDb({ path: dbPath });
  const repos = createRepos(db);

  logger.info('Starting proposal_engagement algorithm', { snapshotId });
  logger.info('Algorithm inputs', inputs);

  try {
    const [proposals, reviews, users] = await Promise.all([
      repos.proposals.findAll(),
      repos.reviews.findAll(),
      repos.users.findAll(),
    ]);

    logger.info('Loaded data from DeepFunding Portal database', {
      proposalCount: proposals.length,
      reviewCount: reviews.length,
      userCount: users.length,
    });

    const communityRatings = aggregateCommunityRatings(reviews);
    const userIdSet = new Set(users.map((u) => u.id));
    const subIdAccumulators = new Map<string, UserScoreAccumulator>(
      subIds.map((subId) => [subId, { positiveSum: 0, negativeSum: 0 }]),
    );
    const benchmarkRecords: ProposalBenchmarkRecord[] = [];
    const matchedSubIds = new Set<string>();
    let totalProposalsScored = 0;
    let proposalsSkippedUnsupportedRound = 0;

    for (let i = 0; i < proposals.length; i++) {
      const proposal = proposals[i];

      if (i % HEARTBEAT_INTERVAL === 0) {
        ctx.heartbeat({ phase: 'scoring', processed: i, total: proposals.length });
      }

      const owners = buildProposalOwners(proposal);
      const communityScore = computeCommunityScore(proposal.id, communityRatings);
      const status = classifyProposal(proposal);
      const timeWeight = computeTimeWeightFromString(proposal.createdAt, now, {
        engagementWindowMonths: inputs.engagementWindowMonths,
        monthlyDecayRatePercent: inputs.monthlyDecayRatePercent,
      });

      const score = computeProposalScore({
        roundId: proposal.roundId,
        classification: status.classification,
        communityScore,
        timeWeight,
      });

      if (score.skipReason === 'unsupported_round') {
        proposalsSkippedUnsupportedRound++;
      }

      benchmarkRecords.push(
        buildProposalBenchmarkRecord(
          proposal,
          {
            proposerId: proposal.proposerId,
            teamMembersArray: owners.teamMembersArray,
            ownersArray: owners.ownersArray,
          },
          status,
          communityScore,
          timeWeight,
          score,
        ),
      );

      if (!score.scored) continue;
      totalProposalsScored++;

      const proposalSubIds = new Set<string>();

      for (const userId of owners.ownersArray) {
        if (!userIdSet.has(userId)) continue;
        for (const subId of deepProposalPortalSubIdsIndex.get(String(userId)) ?? []) {
          proposalSubIds.add(subId);
        }
      }

      for (const subId of proposalSubIds) {
        matchedSubIds.add(subId);
        const existing = subIdAccumulators.get(subId) ?? { positiveSum: 0, negativeSum: 0 };
        subIdAccumulators.set(subId, {
          positiveSum: existing.positiveSum + score.proposalReward,
          negativeSum: existing.negativeSum + score.proposalPenalty,
        });
      }
    }

    const results: ProposalEngagementResult[] = [];
    const subIdScores = new Map<string, number>();

    for (const subId of subIds) {
      const accumulator = subIdAccumulators.get(subId) ?? { positiveSum: 0, negativeSum: 0 };
      const engagement =
        inputs.fundedConcludedRewardWeight * accumulator.positiveSum -
        inputs.unfundedPenaltyWeight * accumulator.negativeSum;
      const roundedEngagement = roundScore(engagement);

      subIdScores.set(subId, roundedEngagement);
      results.push({
        sub_id: subId,
        proposal_engagement: roundedEngagement,
      });
    }

    results.sort((a, b) => a.sub_id.localeCompare(b.sub_id));

    logger.info('Computed proposal engagement scores', {
      userCount: results.length,
    });

    ctx.heartbeat({ phase: 'upload' });

    // Generate and upload CSV output (async to avoid blocking the event loop)
    const csvContent = await stringifyCsvAsync(results, {
      header: true,
      columns: ['sub_id', 'proposal_engagement'],
    });

    const outputKey = generateKey('snapshot', snapshotId, `${snapshot.algorithmPresetFrozen.key}.csv`);

    await storage.putObject({
      bucket: config.storage.bucket,
      key: outputKey,
      body: csvContent,
      contentType: 'text/csv',
    });

    logger.info('Uploaded proposal engagement results', { outputKey });

    // Generate and upload benchmark details
    const benchmark = formatBenchmarkOutput({
      records: benchmarkRecords,
      snapshotId,
      subIds,
      subIdScores,
      subIdAccumulators,
      deepProposalPortalIdBySubId,
      matchedSubIds,
      deepProposalPortalSubIdsIndex,
      params: inputs,
      totalProposalsProcessed: proposals.length,
      totalProposalsScored,
      proposalsSkippedUnsupportedRound,
    });

    const benchmarkKey = generateKey('snapshot', snapshotId, 'proposal_engagement_details.json');

    await storage.putObject({
      bucket: config.storage.bucket,
      key: benchmarkKey,
      body: JSON.stringify(benchmark, null, 2),
      contentType: 'application/json',
    });

    logger.info('Uploaded proposal engagement benchmark', { benchmarkKey });

    return {
      outputs: {
        proposal_engagement: outputKey,
        proposal_engagement_details: benchmarkKey,
      },
    };
  } finally {
    await closeDbInstance(db);
    await rm(dirname(dbPath), { recursive: true, force: true });
  }
}
