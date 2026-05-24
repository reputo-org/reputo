import type { CardanoRawTransactionUtxoData } from '@reputo/onchain-data';

import type { OrderedTransferEvent, ResourceId } from '../types.js';

const BLOCK_HEIGHT_PAD_LENGTH = 12;

function padBlockHeight(blockHeight: number): string {
  return blockHeight.toString().padStart(BLOCK_HEIGHT_PAD_LENGTH, '0');
}

export function normalizeCardanoTransactions(
  txs: CardanoRawTransactionUtxoData[],
  resourceId: ResourceId,
  assetUnit: string,
  trackedAddresses: Set<string>,
): OrderedTransferEvent[] {
  const events: OrderedTransferEvent[] = [];

  for (const tx of txs) {
    const addressFlows = new Map<string, number>();

    for (const input of tx.inputs) {
      if (!trackedAddresses.has(input.address)) continue;
      for (const amt of input.amounts) {
        if (amt.unit !== assetUnit) continue;
        const qty = Number(amt.quantity);
        addressFlows.set(input.address, (addressFlows.get(input.address) ?? 0) - qty);
      }
    }

    for (const output of tx.outputs) {
      if (!trackedAddresses.has(output.address)) continue;
      for (const amt of output.amounts) {
        if (amt.unit !== assetUnit) continue;
        const qty = Number(amt.quantity);
        addressFlows.set(output.address, (addressFlows.get(output.address) ?? 0) + qty);
      }
    }

    const blockTimestamp = new Date(tx.block_time * 1000).toISOString();
    const blockOrdinal = padBlockHeight(tx.block_height);
    let logIndex = 0;

    for (const [address, netFlow] of addressFlows) {
      if (netFlow === 0) continue;

      if (netFlow > 0) {
        events.push({
          resourceId,
          blockOrdinal,
          transactionHash: tx.tx_hash,
          logIndex: logIndex++,
          fromAddress: null,
          toAddress: address,
          amount: netFlow,
          blockTimestamp,
          isStaking: false,
        });
      } else {
        events.push({
          resourceId,
          blockOrdinal,
          transactionHash: tx.tx_hash,
          logIndex: logIndex++,
          fromAddress: address,
          toAddress: null,
          amount: Math.abs(netFlow),
          blockTimestamp,
          isStaking: false,
        });
      }
    }
  }

  return events;
}
