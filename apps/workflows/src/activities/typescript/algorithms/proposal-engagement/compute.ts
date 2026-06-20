import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';

import { closeDbInstance, createDb, createRepos } from '@reputo/deepfunding-portal-api';
import { generateKey, type Storage } from '@reputo/storage';
import { Context } from '@temporalio/activity';

import config from '../../../../config/index.js';
import { HEARTBEAT_INTERVAL } from '../../../../shared/constants/index.js';
import type { AlgorithmResult, Snapshot } from '../../../../shared/types/index.js';
import { stringifyCsvAsync } from '../../../../shared/utils/index.js';
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

    // Every Proposal Portal user is scored, keyed directly by its DID (did:plc).
    const userIdToDid = new Map<number, string>(users.map((u) => [u.id, u.did]));
    const dids = [...new Set(users.map((u) => u.did))].sort((a, b) => a.localeCompare(b));

    const communityRatings = aggregateCommunityRatings(reviews);
    const didAccumulators = new Map<string, UserScoreAccumulator>(
      dids.map((did) => [did, { positiveSum: 0, negativeSum: 0 }]),
    );
    const benchmarkRecords: ProposalBenchmarkRecord[] = [];
    const matchedDids = new Set<string>();
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

      const proposalDids = new Set<string>();

      for (const userId of owners.ownersArray) {
        const did = userIdToDid.get(userId);
        if (did === undefined) continue;
        proposalDids.add(did);
      }

      for (const did of proposalDids) {
        matchedDids.add(did);
        const existing = didAccumulators.get(did) ?? { positiveSum: 0, negativeSum: 0 };
        didAccumulators.set(did, {
          positiveSum: existing.positiveSum + score.proposalReward,
          negativeSum: existing.negativeSum + score.proposalPenalty,
        });
      }
    }

    const results: ProposalEngagementResult[] = [];
    const didScores = new Map<string, number>();

    for (const did of dids) {
      const accumulator = didAccumulators.get(did) ?? { positiveSum: 0, negativeSum: 0 };
      const engagement =
        inputs.fundedConcludedRewardWeight * accumulator.positiveSum -
        inputs.unfundedPenaltyWeight * accumulator.negativeSum;
      const roundedEngagement = roundScore(engagement);

      didScores.set(did, roundedEngagement);
      results.push({
        did: did,
        proposal_engagement: roundedEngagement,
      });
    }

    results.sort((a, b) => a.did.localeCompare(b.did));

    logger.info('Computed proposal engagement scores', {
      userCount: results.length,
    });

    ctx.heartbeat({ phase: 'upload' });

    const csvContent = await stringifyCsvAsync(results, {
      header: true,
      columns: ['did', 'proposal_engagement'],
    });

    const outputKey = generateKey('snapshot', snapshotId, `${snapshot.algorithmPresetFrozen.key}.csv`);

    await storage.putObject({
      bucket: config.storage.bucket,
      key: outputKey,
      body: csvContent,
      contentType: 'text/csv',
    });

    logger.info('Uploaded proposal engagement results', { outputKey });

    const benchmark = formatBenchmarkOutput({
      records: benchmarkRecords,
      snapshotId,
      dids,
      didScores,
      didAccumulators,
      matchedDids,
      userIdToDid,
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
