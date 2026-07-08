import type { OnchainReadRepositories } from '@reputo/onchain-data';

import { normalizeCardanoTransactions, normalizeEvmTransfers } from '../normalizers/index.js';
import type { OrderedTransferEvent, ResourceId } from '../types.js';

export type TransferPage = {
  items: OrderedTransferEvent[];
  hasMore: boolean;
};

export async function loadEvmTransferPage(input: {
  repos: OnchainReadRepositories;
  chain: string;
  assetIdentifier: string;
  resourceId: ResourceId;
  walletAddresses: string[];
  page: number;
  limit: number;
  stakingAddresses: Set<string>;
  fromTimestampUnix?: number;
  toTimestampUnix?: number;
}): Promise<TransferPage> {
  if (input.walletAddresses.length === 0) {
    return { items: [], hasMore: false };
  }

  const rows = await input.repos.evm.findTransfersByAddresses({
    chain: input.chain,
    assetIdentifier: input.assetIdentifier,
    addresses: input.walletAddresses,
    page: input.page,
    limit: input.limit,
    orderBy: 'time_asc',
    fromTimestampUnix: input.fromTimestampUnix,
    toTimestampUnix: input.toTimestampUnix,
  });

  const events = normalizeEvmTransfers(rows, input.resourceId, input.stakingAddresses);

  return {
    items: events,
    hasMore: rows.length === input.limit,
  };
}

export async function loadCardanoTransferPage(input: {
  repos: OnchainReadRepositories;
  assetIdentifier: string;
  assetDecimals?: number;
  resourceId: ResourceId;
  walletAddresses: string[];
  page: number;
  limit: number;
  trackedAddresses: Set<string>;
  fromTimestampUnix?: number;
  toTimestampUnix?: number;
}): Promise<TransferPage> {
  if (input.walletAddresses.length === 0) {
    return { items: [], hasMore: false };
  }

  const txs = await input.repos.cardano.findTransactionsByAddresses({
    assetIdentifier: input.assetIdentifier,
    addresses: input.walletAddresses,
    page: input.page,
    limit: input.limit,
    fromTimestampUnix: input.fromTimestampUnix,
    toTimestampUnix: input.toTimestampUnix,
  });

  const events = normalizeCardanoTransactions(
    txs,
    input.resourceId,
    input.assetIdentifier,
    input.trackedAddresses,
    input.assetDecimals ?? 0,
  );

  return {
    items: events,
    hasMore: txs.length === input.limit,
  };
}
