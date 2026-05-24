import { generateKey, type Storage } from '@reputo/storage';
import { Context } from '@temporalio/activity';

import config from '../../../../config/index.js';
import { HEARTBEAT_INTERVAL } from '../../../../shared/constants/index.js';
import type { AlgorithmResult, Snapshot } from '../../../../shared/types/index.js';
import { stringifyCsvAsync } from '../../../../shared/utils/index.js';
import { buildDeepVotingPortalSubIdsIndex, getSubIds, loadSubIdInputMap } from '../shared/sub-id-input.js';
import { buildVoterBenchmarkRecord, formatBenchmarkOutput } from './benchmark/index.js';
import { calculateVotingEngagement, groupVotesByVoter } from './pipeline/index.js';
import type { SubIdBenchmarkRecord, VotingEngagementResult } from './types.js';
import { roundScore } from './types.js';
import { extractInputKeys, loadVotes } from './utils/index.js';

export async function computeVotingEngagement(snapshot: Snapshot, storage: Storage): Promise<AlgorithmResult> {
  const ctx = Context.current();
  const logger = ctx.log;
  const snapshotId = snapshot.id;

  logger.info('Starting voting_engagement algorithm', { snapshotId });

  const { bucket } = config.storage;
  const { subIdsKey, votesKey } = extractInputKeys(snapshot.algorithmPresetFrozen.inputs);
  const subIdInputMap = await loadSubIdInputMap({
    storage,
    bucket,
    key: subIdsKey,
  });
  const subIds = getSubIds(subIdInputMap);
  const deepVotingPortalSubIdsIndex = buildDeepVotingPortalSubIdsIndex(subIdInputMap);
  const targetedVoterIds = new Set(deepVotingPortalSubIdsIndex.keys());

  logger.debug('Resolved input locations', { subIdsKey, votesKey, subIdCount: subIds.length });

  const votes = await loadVotes(storage, bucket, votesKey);

  logger.info('Parsed input votes', { rowCount: votes.length });

  const { votesByVoter, stats } = groupVotesByVoter(votes, targetedVoterIds);

  logger.info('Vote processing summary', stats);

  const scoreByVoterId = new Map<string, number>();
  for (const [voterId, voterVotes] of votesByVoter.entries()) {
    scoreByVoterId.set(voterId, roundScore(calculateVotingEngagement(voterVotes)));
  }

  const results: VotingEngagementResult[] = [];
  const benchmarkRecords: SubIdBenchmarkRecord[] = [];
  const matchedSubIds = new Set<string>();

  let processed = 0;
  for (const subId of subIds) {
    if (processed % HEARTBEAT_INTERVAL === 0) {
      ctx.heartbeat({ phase: 'scoring', processed, total: subIds.length });
    }
    processed++;

    const deepVotingPortalId = subIdInputMap.subIds[subId]?.deepVotingPortalId ?? null;
    const voterVotes = deepVotingPortalId ? (votesByVoter.get(deepVotingPortalId) ?? []) : [];
    const votingEngagement = deepVotingPortalId ? (scoreByVoterId.get(deepVotingPortalId) ?? 0) : 0;

    if (voterVotes.length > 0) {
      matchedSubIds.add(subId);
    }

    results.push({
      sub_id: subId,
      voting_engagement: votingEngagement,
    });

    benchmarkRecords.push(buildVoterBenchmarkRecord(subId, deepVotingPortalId, voterVotes, votingEngagement));
  }

  results.sort((a, b) => a.sub_id.localeCompare(b.sub_id));

  logger.info('Computed voting engagement scores', {
    resultCount: results.length,
  });

  ctx.heartbeat({ phase: 'upload' });

  const csvContent = await stringifyCsvAsync(results, {
    header: true,
    columns: ['sub_id', 'voting_engagement'],
  });

  const outputKey = generateKey('snapshot', snapshotId, `${snapshot.algorithmPresetFrozen.key}.csv`);

  await storage.putObject({
    bucket,
    key: outputKey,
    body: csvContent,
    contentType: 'text/csv',
  });

  logger.info('Uploaded voting engagement results', { outputKey });

  const benchmark = formatBenchmarkOutput({
    records: benchmarkRecords,
    snapshotId,
    stats,
    matchedSubIds,
  });

  const benchmarkKey = generateKey('snapshot', snapshotId, 'voting_engagement_details.json');

  await storage.putObject({
    bucket,
    key: benchmarkKey,
    body: JSON.stringify(benchmark, null, 2),
    contentType: 'application/json',
  });

  logger.info('Uploaded voting engagement benchmark', { benchmarkKey });

  return {
    outputs: {
      voting_engagement: outputKey,
      voting_engagement_details: benchmarkKey,
    },
  };
}
