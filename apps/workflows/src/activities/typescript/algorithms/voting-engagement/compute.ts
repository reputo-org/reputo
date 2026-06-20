import { generateKey, type Storage } from '@reputo/storage';
import { Context } from '@temporalio/activity';

import config from '../../../../config/index.js';
import { HEARTBEAT_INTERVAL } from '../../../../shared/constants/index.js';
import type { AlgorithmResult, Snapshot } from '../../../../shared/types/index.js';
import { stringifyCsvAsync } from '../../../../shared/utils/index.js';
import { type DidInputMap, getDids, loadDidInputMap } from '../shared/did-input.js';
import { buildVoterBenchmarkRecord, formatBenchmarkOutput } from './benchmark/index.js';
import { calculateVotingEngagement, groupVotesByVoter } from './pipeline/index.js';
import type { DidBenchmarkRecord, VotingEngagementResult } from './types.js';
import { roundScore } from './types.js';
import { extractInputKeys, loadVotes, loadWalletCollectionIndex } from './utils/index.js';

/**
 * Resolves each SubID to the voting `collection_id`(s) it should be scored on, by
 * joining the SubID's wallets (from DeepID) to the wallet collections CSV
 * (wallet → collection_id), per the DeepID integration spec §12.1.
 */
function resolveCollectionIdsByDid(
  didInputMap: DidInputMap,
  walletCollectionIndex: Map<string, string[]>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();

  for (const [did, entry] of Object.entries(didInputMap.dids)) {
    const collectionIds = new Set<string>();

    for (const wallet of entry.userWallets) {
      for (const collectionId of walletCollectionIndex.get(wallet.address.toLowerCase()) ?? []) {
        collectionIds.add(collectionId);
      }
    }

    result.set(did, [...collectionIds]);
  }

  return result;
}

export async function computeVotingEngagement(snapshot: Snapshot, storage: Storage): Promise<AlgorithmResult> {
  const ctx = Context.current();
  const logger = ctx.log;
  const snapshotId = snapshot.id;

  logger.info('Starting voting_engagement algorithm', { snapshotId });

  const { bucket } = config.storage;
  const { didsKey, votesKey, walletCollectionsKey } = extractInputKeys(snapshot.algorithmPresetFrozen.inputs);
  const didInputMap = await loadDidInputMap({
    storage,
    bucket,
    key: didsKey,
  });
  const dids = getDids(didInputMap);

  const walletCollectionIndex = await loadWalletCollectionIndex(storage, bucket, walletCollectionsKey);

  const collectionIdsByDid = resolveCollectionIdsByDid(didInputMap, walletCollectionIndex);
  const targetedVoterIds = new Set<string>();
  for (const collectionIds of collectionIdsByDid.values()) {
    for (const collectionId of collectionIds) {
      targetedVoterIds.add(collectionId);
    }
  }

  logger.debug('Resolved input locations', {
    didsKey,
    votesKey,
    walletCollectionsKey,
    didCount: dids.length,
    targetedCollectionCount: targetedVoterIds.size,
  });

  const votes = await loadVotes(storage, bucket, votesKey);

  logger.info('Parsed input votes', { rowCount: votes.length });

  const { votesByVoter, stats } = groupVotesByVoter(votes, targetedVoterIds);

  logger.info('Vote processing summary', stats);

  const results: VotingEngagementResult[] = [];
  const benchmarkRecords: DidBenchmarkRecord[] = [];
  const matchedDids = new Set<string>();

  let processed = 0;
  for (const did of dids) {
    if (processed % HEARTBEAT_INTERVAL === 0) {
      ctx.heartbeat({ phase: 'scoring', processed, total: dids.length });
    }
    processed++;

    const collectionIds = collectionIdsByDid.get(did) ?? [];
    const voterVotes = collectionIds.flatMap((collectionId) => votesByVoter.get(collectionId) ?? []);
    const votingEngagement = voterVotes.length > 0 ? roundScore(calculateVotingEngagement(voterVotes)) : 0;

    if (voterVotes.length > 0) {
      matchedDids.add(did);
    }

    results.push({
      did: did,
      voting_engagement: votingEngagement,
    });

    benchmarkRecords.push(buildVoterBenchmarkRecord(did, voterVotes, votingEngagement, collectionIds));
  }

  results.sort((a, b) => a.did.localeCompare(b.did));

  logger.info('Computed voting engagement scores', {
    resultCount: results.length,
  });

  ctx.heartbeat({ phase: 'upload' });

  const csvContent = await stringifyCsvAsync(results, {
    header: true,
    columns: ['did', 'voting_engagement'],
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
    matchedDids,
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
