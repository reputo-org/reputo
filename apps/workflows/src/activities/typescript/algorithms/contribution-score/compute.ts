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
import { buildCommentBenchmarkRecord, formatBenchmarkOutput } from './benchmark/index.js';
import {
  aggregateVotesByComment,
  calculateBaseScore,
  computeCommentScore,
  computeOwnerBonus,
  computeTimeWeightFromString,
  detectSelfInteraction,
  getVoteStats,
} from './pipeline/index.js';
import type { CommentBenchmarkRecord, ContributionScoreResult } from './types.js';
import { roundScore } from './types.js';
import {
  buildCommentAuthorMap,
  buildProjectOwnerMap,
  buildRelationMap,
  createDeepFundingDb,
  extractInputs,
} from './utils/index.js';

export async function computeContributionScore(snapshot: Snapshot, storage: Storage): Promise<AlgorithmResult> {
  const ctx = Context.current();
  const logger = ctx.log;
  const snapshotId = snapshot.id;

  const params = extractInputs(snapshot.algorithmPresetFrozen.inputs);
  const subIdInputMap = await loadSubIdInputMap({
    storage,
    bucket: config.storage.bucket,
    key: params.subIdsKey,
  });
  const subIds = getSubIds(subIdInputMap);
  const deepProposalPortalSubIdsIndex = buildDeepProposalPortalSubIdsIndex(subIdInputMap);
  const deepProposalPortalIdBySubId = new Map(
    subIds.map((subId) => [subId, subIdInputMap.subIds[subId]?.deepProposalPortalId ?? null]),
  );
  const dbPath = await createDeepFundingDb(snapshotId, storage);
  const db = await createDb({ path: dbPath });
  const repos = createRepos(db);

  logger.info('Starting contribution_score algorithm', { snapshotId });
  logger.info('Algorithm parameters', params);

  try {
    const [comments, commentVotes, proposals, users] = await Promise.all([
      repos.comments.findAll(),
      repos.commentVotes.findAll(),
      repos.proposals.findAll(),
      repos.users.findAll(),
    ]);

    logger.info('Loaded data from DeepFunding Portal database', {
      commentCount: comments.length,
      commentVoteCount: commentVotes.length,
      proposalCount: proposals.length,
      userCount: users.length,
    });

    // Build lookup maps
    const relationMap = buildRelationMap(proposals);
    const projectOwnerMap = buildProjectOwnerMap(proposals);
    const commentAuthorMap = buildCommentAuthorMap(comments);
    const voteMap = aggregateVotesByComment(commentVotes);
    const userIdSet = new Set(users.map((u) => u.id));

    const now = new Date();
    const subIdScores = new Map<string, number>(subIds.map((subId) => [subId, 0]));
    const matchedSubIds = new Set<string>();
    const benchmarkRecords: CommentBenchmarkRecord[] = [];
    let totalCommentsScored = 0;

    // Process each comment through the pipeline
    // Only score comments whose author exists in the users table
    for (let i = 0; i < comments.length; i++) {
      if (i % HEARTBEAT_INTERVAL === 0) {
        ctx.heartbeat({ phase: 'scoring', processed: i, total: comments.length });
      }

      const comment = comments[i];
      if (!userIdSet.has(comment.userId)) continue;

      const votes = getVoteStats(comment.commentId, voteMap);

      const timeWeight = computeTimeWeightFromString(comment.createdAt, now, {
        engagementWindowMonths: params.engagementWindowMonths,
        monthlyDecayRatePercent: params.monthlyDecayRatePercent,
      });

      const selfInteraction = detectSelfInteraction(comment, params.selfInteractionPenaltyFactor, {
        relationMap,
        commentAuthorMap,
      });

      const ownerBonus = computeOwnerBonus(
        comment.proposalId,
        votes,
        projectOwnerMap,
        params.projectOwnerUpvoteBonusMultiplier,
      );

      const baseScore = calculateBaseScore(votes, params);
      const result = computeCommentScore({
        votes,
        params,
        timeWeight,
        selfInteraction,
        ownerBonus,
      });

      benchmarkRecords.push(
        buildCommentBenchmarkRecord(comment, votes, timeWeight, selfInteraction, ownerBonus, result, baseScore),
      );

      if (result.scored) {
        totalCommentsScored++;

        for (const subId of deepProposalPortalSubIdsIndex.get(String(comment.userId)) ?? []) {
          matchedSubIds.add(subId);
          const currentScore = subIdScores.get(subId) ?? 0;
          subIdScores.set(subId, currentScore + result.score);
        }
      }
    }

    const results: ContributionScoreResult[] = [];

    for (const subId of subIds) {
      results.push({
        sub_id: subId,
        contribution_score: roundScore(subIdScores.get(subId) ?? 0),
      });
    }

    results.sort((a, b) => a.sub_id.localeCompare(b.sub_id));

    logger.info('Computed contribution scores', {
      userCount: results.length,
    });

    ctx.heartbeat({ phase: 'upload' });

    // Generate and upload CSV output (async to avoid blocking the event loop)
    const csvContent = await stringifyCsvAsync(results, {
      header: true,
      columns: ['sub_id', 'contribution_score'],
    });

    const outputKey = generateKey('snapshot', snapshotId, `${snapshot.algorithmPresetFrozen.key}.csv`);

    await storage.putObject({
      bucket: config.storage.bucket,
      key: outputKey,
      body: csvContent,
      contentType: 'text/csv',
    });

    logger.info('Uploaded contribution score results', { outputKey });

    const roundedSubIdScores = new Map(results.map((result) => [result.sub_id, result.contribution_score]));
    const benchmark = formatBenchmarkOutput({
      records: benchmarkRecords,
      snapshotId,
      subIds,
      subIdScores: roundedSubIdScores,
      deepProposalPortalIdBySubId,
      matchedSubIds,
      deepProposalPortalSubIdsIndex,
      params,
      totalCommentsProcessed: comments.length,
      totalCommentsScored,
    });
    const benchmarkKey = generateKey('snapshot', snapshotId, 'contribution_score_details.json');

    await storage.putObject({
      bucket: config.storage.bucket,
      key: benchmarkKey,
      body: JSON.stringify(benchmark, null, 2),
      contentType: 'application/json',
    });

    logger.info('Uploaded contribution score benchmark', { benchmarkKey });

    return {
      outputs: {
        contribution_score: outputKey,
        contribution_score_details: benchmarkKey,
      },
    };
  } finally {
    await closeDbInstance(db);
    await rm(dirname(dbPath), { recursive: true, force: true });
  }
}
