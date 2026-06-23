import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';

import { closeDbInstance, createDb, createRepos } from '@reputo/deepfunding-portal-api';
import { generateKey, type Storage } from '@reputo/storage';
import { Context } from '@temporalio/activity';

import config from '../../../../config/index.js';
import { HEARTBEAT_INTERVAL } from '../../../../shared/constants/index.js';
import type { AlgorithmResult, Snapshot } from '../../../../shared/types/index.js';
import { stringifyCsvAsync } from '../../../../shared/utils/index.js';
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

    // Every Proposal Portal user with a DID is scored, keyed directly by its DID
    // (did:plc). Users without a DID are skipped — there is nowhere to post their score.
    const usersWithDid = users.filter((u) => u.did.trim() !== '');
    const userIdToDid = new Map<number, string>(usersWithDid.map((u) => [u.id, u.did]));
    const dids = [...new Set(usersWithDid.map((u) => u.did))].sort((a, b) => a.localeCompare(b));

    const relationMap = buildRelationMap(proposals);
    const projectOwnerMap = buildProjectOwnerMap(proposals);
    const commentAuthorMap = buildCommentAuthorMap(comments);
    const voteMap = aggregateVotesByComment(commentVotes);

    const now = new Date();
    const didScores = new Map<string, number>(dids.map((did) => [did, 0]));
    const matchedDids = new Set<string>();
    const benchmarkRecords: CommentBenchmarkRecord[] = [];
    let totalCommentsScored = 0;

    for (let i = 0; i < comments.length; i++) {
      if (i % HEARTBEAT_INTERVAL === 0) {
        ctx.heartbeat({ phase: 'scoring', processed: i, total: comments.length });
      }

      const comment = comments[i];
      const did = userIdToDid.get(comment.userId);
      if (did === undefined) continue;

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
        matchedDids.add(did);
        didScores.set(did, (didScores.get(did) ?? 0) + result.score);
      }
    }

    const results: ContributionScoreResult[] = dids.map((did) => ({
      did,
      contribution_score: roundScore(didScores.get(did) ?? 0),
    }));

    results.sort((a, b) => a.did.localeCompare(b.did));

    logger.info('Computed contribution scores', {
      userCount: results.length,
    });

    ctx.heartbeat({ phase: 'upload' });

    const csvContent = await stringifyCsvAsync(results, {
      header: true,
      columns: ['did', 'contribution_score'],
    });

    const outputKey = generateKey('snapshot', snapshotId, `${snapshot.algorithmPresetFrozen.key}.csv`);

    await storage.putObject({
      bucket: config.storage.bucket,
      key: outputKey,
      body: csvContent,
      contentType: 'text/csv',
    });

    logger.info('Uploaded contribution score results', { outputKey });

    const roundedDidScores = new Map(results.map((result) => [result.did, result.contribution_score]));
    const benchmark = formatBenchmarkOutput({
      records: benchmarkRecords,
      snapshotId,
      dids,
      didScores: roundedDidScores,
      matchedDids,
      userIdToDid,
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
