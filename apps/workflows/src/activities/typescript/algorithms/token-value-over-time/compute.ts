import { generateKey, type Storage } from '@reputo/storage';
import { Context } from '@temporalio/activity';

import config from '../../../../config/index.js';
import { HEARTBEAT_INTERVAL } from '../../../../shared/constants/index.js';
import type { AlgorithmResult, Snapshot } from '../../../../shared/types/index.js';
import { stringifyCsvAsync } from '../../../../shared/utils/index.js';
import { formatBenchmarkOutput } from './benchmark/index.js';
import { replayTransfers, scoreWalletLots } from './pipeline/index.js';
import { type DidScoreDetail, type ResolvedResource, roundScore, type WalletScoreDetail } from './types.js';
import {
  buildWalletDidsIndex,
  createOnchainRepos,
  extractInputs,
  getDids,
  getStakingContractAddresses,
  getWalletsForChain,
  getWalletsForSelectedResources,
  initializeWalletLots,
  loadCardanoTransferPage,
  loadEvmTransferPage,
  loadResourceCatalog,
  loadWalletAddressMap,
  resolveSelectedResources,
} from './utils/index.js';

const TRANSFERS_PAGE_LIMIT = 500;
const WALLET_CHUNK_SIZE = 100;

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

export async function computeTokenValueOverTime(snapshot: Snapshot, storage: Storage): Promise<AlgorithmResult> {
  const ctx = Context.current();
  const logger = ctx.log;
  const snapshotId = snapshot.id;

  const snapshotCreatedAt = new Date(snapshot.createdAt ?? new Date());

  const params = extractInputs(snapshot.algorithmPresetFrozen.inputs, snapshotCreatedAt);
  const catalog = loadResourceCatalog();
  const resolvedResources = resolveSelectedResources(params.selectedResources, catalog);
  const stakingAddresses = getStakingContractAddresses(catalog);
  const selectedResourceIds = new Set(resolvedResources.map((r) => r.resourceId));

  const walletAddressMap = await loadWalletAddressMap({
    storage,
    bucket: config.storage.bucket,
    key: params.didsKey,
  });
  const dids = getDids(walletAddressMap);
  const walletDidsIndex = buildWalletDidsIndex(walletAddressMap);
  const targetWallets = getWalletsForSelectedResources(walletAddressMap, params.selectedResources);

  logger.info('Starting token_value_over_time algorithm', { snapshotId });
  logger.info('Algorithm parameters', {
    maturationThresholdDays: params.maturationThresholdDays,
    selectedResources: params.selectedResources,
    resolvedResourceCount: resolvedResources.length,
    didsKey: params.didsKey,
    effectiveDateRange: params.effectiveDateRange,
  });
  logger.info('Target wallets loaded', {
    didCount: dids.length,
    walletCount: targetWallets.length,
    resourceIdCount: selectedResourceIds.size,
  });

  const repos = await createOnchainRepos();

  try {
    const targetWalletSet = new Set(targetWallets);
    const walletLots = initializeWalletLots(targetWallets);
    const replayStats = {
      processed: 0,
      skippedZeroAmount: 0,
      skippedSelfTransfers: 0,
      skippedStaking: 0,
    };
    let transferCount = 0;
    const processedTokens = new Set<string>();

    for (let i = 0; i < resolvedResources.length; i++) {
      const resource = resolvedResources[i];
      const tokenDedupeKey = `${resource.chain}:${resource.tokenIdentifier.toLowerCase()}`;
      if (processedTokens.has(tokenDedupeKey)) {
        logger.info('Skipping duplicate token transfer loading', {
          resourceId: resource.resourceId,
          tokenDedupeKey,
          resourceIndex: i + 1,
          totalResources: resolvedResources.length,
        });
        continue;
      }
      processedTokens.add(tokenDedupeKey);

      const chainWallets = getWalletsForChain(walletAddressMap, resource.chain);
      const walletChunks = chunkArray(chainWallets, WALLET_CHUNK_SIZE);
      let pagesProcessed = 0;
      let chainTransferCount = 0;

      logger.info('Processing resource', {
        resourceId: resource.resourceId,
        chain: resource.chain,
        identifier: resource.tokenIdentifier,
        kind: resource.kind,
        resourceIndex: i + 1,
        totalResources: resolvedResources.length,
        walletCount: chainWallets.length,
        walletChunkCount: walletChunks.length,
      });

      for (let chunkIndex = 0; chunkIndex < walletChunks.length; chunkIndex++) {
        const walletChunk = walletChunks[chunkIndex];
        let pageNumber = 1;

        while (true) {
          ctx.heartbeat({
            phase: 'load-transfers',
            resourceId: resource.resourceId,
            processedResources: i + 1,
            totalResources: resolvedResources.length,
            pageNumber,
            chunkIndex: chunkIndex + 1,
            totalChunks: walletChunks.length,
            transferCount,
          });

          const fetchStartedAt = Date.now();
          const transferPage = await loadTransferPage(resource, {
            repos,
            walletChunk,
            pageNumber,
            limit: TRANSFERS_PAGE_LIMIT,
            stakingAddresses,
            effectiveDateRange: params.effectiveDateRange,
          });
          const fetchDurationMs = Date.now() - fetchStartedAt;

          pagesProcessed += 1;
          logger.info('Transfer page received', {
            resourceId: resource.resourceId,
            pageNumber,
            chunkIndex: chunkIndex + 1,
            totalChunks: walletChunks.length,
            itemCount: transferPage.items.length,
            hasMore: transferPage.hasMore,
            fetchDurationMs,
          });
          chainTransferCount += transferPage.items.length;
          transferCount += transferPage.items.length;

          const pageReplayStats = replayTransfers(walletLots, transferPage.items, targetWalletSet);
          replayStats.processed += pageReplayStats.processed;
          replayStats.skippedZeroAmount += pageReplayStats.skippedZeroAmount;
          replayStats.skippedSelfTransfers += pageReplayStats.skippedSelfTransfers;
          replayStats.skippedStaking += pageReplayStats.skippedStaking;

          if (pagesProcessed % HEARTBEAT_INTERVAL === 0 || !transferPage.hasMore) {
            ctx.heartbeat({
              phase: 'load-transfers',
              resourceId: resource.resourceId,
              processedResources: i + 1,
              totalResources: resolvedResources.length,
              pageNumber,
              chunkIndex: chunkIndex + 1,
              totalChunks: walletChunks.length,
              transferCount,
            });
          }

          if (transferPage.items.length === 0 && transferPage.hasMore) {
            logger.warn('Stopping pagination due to empty transfer page with hasMore=true', {
              resourceId: resource.resourceId,
              chunkIndex: chunkIndex + 1,
              pageNumber,
            });
            break;
          }
          if (!transferPage.hasMore) {
            break;
          }

          pageNumber += 1;
        }
      }

      logger.info('Resource completed', {
        resourceId: resource.resourceId,
        pagesProcessed,
        transfersInResource: chainTransferCount,
      });
    }

    logger.info('Computing wallet scores');
    const walletScores = scoreWalletLots({
      lotsState: walletLots,
      selectedResourceIds,
      snapshotCreatedAt,
      maturationThresholdDays: params.maturationThresholdDays,
    });
    const didScores = aggregateWalletScoresByDid({
      dids,
      walletScores,
      walletDidsIndex,
    });

    logger.info('Computed token value over time scores', {
      didCount: didScores.length,
      walletCount: walletScores.length,
      transferCount,
      replayStats,
    });

    ctx.heartbeat({ phase: 'upload' });
    logger.info('Uploading outputs');

    const csvRows = didScores.map((did) => ({
      did: did.did,
      token_value: did.token_value,
    }));
    const csv = await stringifyCsvAsync(csvRows, {
      header: true,
      columns: ['did', 'token_value'],
    });

    const outputKey = generateKey('snapshot', snapshotId, `${snapshot.algorithmPresetFrozen.key}.csv`);
    await storage.putObject({
      bucket: config.storage.bucket,
      key: outputKey,
      body: csv,
      contentType: 'text/csv',
    });
    logger.info('CSV uploaded', { key: outputKey });

    const benchmark = formatBenchmarkOutput({
      snapshotId,
      maturationThresholdDays: params.maturationThresholdDays,
      selectedResources: params.selectedResources,
      selectedResourceIds: [...selectedResourceIds],
      didCount: dids.length,
      targetWalletCount: targetWallets.length,
      transferCount,
      replay: replayStats,
      dids: didScores,
    });

    const detailsKey = generateKey('snapshot', snapshotId, 'token_value_over_time_details.json');
    await storage.putObject({
      bucket: config.storage.bucket,
      key: detailsKey,
      body: JSON.stringify(benchmark, null, 2),
      contentType: 'application/json',
    });
    logger.info('Details uploaded', { key: detailsKey });

    logger.info('Token value over time completed', {
      snapshotId,
      outputKey,
      detailsKey,
      transferCount,
      walletCount: walletScores.length,
    });
    return {
      outputs: {
        token_value_over_time: outputKey,
        token_value_over_time_details: detailsKey,
      },
    };
  } finally {
    await repos.close();
  }
}

async function loadTransferPage(
  resource: ResolvedResource,
  ctx: {
    repos: Awaited<ReturnType<typeof createOnchainRepos>>;
    walletChunk: string[];
    pageNumber: number;
    limit: number;
    stakingAddresses: Set<string>;
    effectiveDateRange: { fromTimestampUnix?: number; toTimestampUnix: number };
  },
) {
  const commonInput = {
    repos: ctx.repos,
    resourceId: resource.resourceId,
    walletAddresses: ctx.walletChunk,
    page: ctx.pageNumber,
    limit: ctx.limit,
    fromTimestampUnix: ctx.effectiveDateRange.fromTimestampUnix,
    toTimestampUnix: ctx.effectiveDateRange.toTimestampUnix,
  };

  switch (resource.chain) {
    case 'ethereum':
      return loadEvmTransferPage({
        ...commonInput,
        chain: resource.chain,
        assetIdentifier: resource.tokenIdentifier,
        stakingAddresses: ctx.stakingAddresses,
      });
    case 'cardano':
      return loadCardanoTransferPage({
        ...commonInput,
        assetIdentifier: resource.tokenIdentifier,
        trackedAddresses: new Set(ctx.walletChunk),
      });
    default:
      throw new Error(`Unsupported chain: ${resource.chain}`);
  }
}

function aggregateWalletScoresByDid(input: {
  dids: string[];
  walletScores: WalletScoreDetail[];
  walletDidsIndex: Map<string, string[]>;
}): DidScoreDetail[] {
  const didMap = new Map<string, DidScoreDetail>(
    input.dids.map((did) => [
      did,
      {
        did: did,
        token_value: 0,
        wallets: [],
      },
    ]),
  );

  for (const walletScore of input.walletScores) {
    const targetDids = input.walletDidsIndex.get(walletScore.wallet_address) ?? [];

    for (const did of targetDids) {
      const aggregate = didMap.get(did);
      if (!aggregate) continue;

      aggregate.token_value = roundScore(aggregate.token_value + walletScore.token_value);
      aggregate.wallets.push(walletScore);
    }
  }

  const rows = [...didMap.values()];
  for (const row of rows) {
    row.wallets.sort((a, b) => a.wallet_address.localeCompare(b.wallet_address));
  }

  return rows.sort((a, b) => a.did.localeCompare(b.did));
}
