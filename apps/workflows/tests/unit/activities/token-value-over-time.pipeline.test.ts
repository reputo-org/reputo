import { describe, expect, it } from 'vitest';

import {
  replayTransfers,
  scoreWalletLots,
} from '../../../src/activities/typescript/algorithms/token-value-over-time/pipeline/index.js';
import type {
  OrderedTransferEvent,
  ResourceId,
  WalletLotsState,
} from '../../../src/activities/typescript/algorithms/token-value-over-time/types.js';

const FET_ETHEREUM: ResourceId = 'ethereum:0xaea46a60368a7bd060eec7df8cba43b7ef41ad85';

describe('token-value-over-time pipeline', () => {
  it('consumes lots in FIFO order and computes linear maturation weights', () => {
    const wallet = '0x0000000000000000000000000000000000000001';
    const state: WalletLotsState = new Map([[wallet, []]]);
    const transfers: OrderedTransferEvent[] = [
      {
        resourceId: FET_ETHEREUM,
        blockOrdinal: '0x1',
        transactionHash: '0xaaa',
        logIndex: 0,
        fromAddress: '0x0000000000000000000000000000000000000010',
        toAddress: wallet,
        amount: 10,
        blockTimestamp: '2026-01-01T00:00:00.000Z',
        isStaking: false,
      },
      {
        resourceId: FET_ETHEREUM,
        blockOrdinal: '0x2',
        transactionHash: '0xbbb',
        logIndex: 0,
        fromAddress: '0x0000000000000000000000000000000000000020',
        toAddress: wallet,
        amount: 6,
        blockTimestamp: '2026-02-01T00:00:00.000Z',
        isStaking: false,
      },
      {
        resourceId: FET_ETHEREUM,
        blockOrdinal: '0x3',
        transactionHash: '0xccc',
        logIndex: 0,
        fromAddress: wallet,
        toAddress: '0x0000000000000000000000000000000000000030',
        amount: 12,
        blockTimestamp: '2026-03-01T00:00:00.000Z',
        isStaking: false,
      },
    ];

    const stats = replayTransfers(state, transfers, new Set([wallet]));
    expect(stats).toEqual({
      processed: 3,
      skippedZeroAmount: 0,
      skippedSelfTransfers: 0,
      skippedStaking: 0,
    });

    const results = scoreWalletLots({
      lotsState: state,
      selectedResourceIds: new Set([FET_ETHEREUM]),
      snapshotCreatedAt: new Date('2026-04-01T00:00:00.000Z'),
      maturationThresholdDays: 90,
    });

    expect(results).toHaveLength(1);
    expect(results[0].wallet_address).toBe(wallet);
    expect(results[0].lots).toHaveLength(1);

    const [lot] = results[0].lots;
    expect(lot.amount_remaining).toBe(4);
    expect(lot.weight).toBeCloseTo(59 / 90, 4);
    expect(results[0].token_value).toBeCloseTo((4 * 59) / 90, 4);
  });

  it('ignores self-transfers and zero-amount transfers', () => {
    const wallet = '0x0000000000000000000000000000000000000001';
    const state: WalletLotsState = new Map([[wallet, []]]);
    const transfers: OrderedTransferEvent[] = [
      {
        resourceId: FET_ETHEREUM,
        blockOrdinal: '0x1',
        transactionHash: '0xaaa',
        logIndex: 0,
        fromAddress: wallet,
        toAddress: wallet,
        amount: 100,
        blockTimestamp: '2026-01-01T00:00:00.000Z',
        isStaking: false,
      },
      {
        resourceId: FET_ETHEREUM,
        blockOrdinal: '0x2',
        transactionHash: '0xbbb',
        logIndex: 0,
        fromAddress: '0x0000000000000000000000000000000000000002',
        toAddress: wallet,
        amount: 0,
        blockTimestamp: '2026-01-02T00:00:00.000Z',
        isStaking: false,
      },
    ];

    const stats = replayTransfers(state, transfers, new Set([wallet]));

    expect(stats.processed).toBe(2);
    expect(stats.skippedSelfTransfers).toBe(1);
    expect(stats.skippedZeroAmount).toBe(1);
    expect(state.get(wallet)).toEqual([]);
  });

  it('skips staking transfers without affecting lots', () => {
    const wallet = '0x0000000000000000000000000000000000000001';
    const stakingContract = '0xcb85b101c4822a4e3abca20e57f1dff0e2673475';
    const state: WalletLotsState = new Map([[wallet, []]]);

    const transfers: OrderedTransferEvent[] = [
      {
        resourceId: FET_ETHEREUM,
        blockOrdinal: '0x1',
        transactionHash: '0xaaa',
        logIndex: 0,
        fromAddress: '0x0000000000000000000000000000000000000010',
        toAddress: wallet,
        amount: 100,
        blockTimestamp: '2026-01-01T00:00:00.000Z',
        isStaking: false,
      },
      {
        resourceId: FET_ETHEREUM,
        blockOrdinal: '0x2',
        transactionHash: '0xbbb',
        logIndex: 0,
        fromAddress: wallet,
        toAddress: stakingContract,
        amount: 50,
        blockTimestamp: '2026-02-01T00:00:00.000Z',
        isStaking: true,
      },
      {
        resourceId: FET_ETHEREUM,
        blockOrdinal: '0x3',
        transactionHash: '0xccc',
        logIndex: 0,
        fromAddress: stakingContract,
        toAddress: wallet,
        amount: 50,
        blockTimestamp: '2026-03-01T00:00:00.000Z',
        isStaking: true,
      },
    ];

    const stats = replayTransfers(state, transfers, new Set([wallet]));

    expect(stats.processed).toBe(3);
    expect(stats.skippedStaking).toBe(2);

    const lots = state.get(wallet);
    expect(lots).toBeDefined();
    if (lots == null) {
      throw new Error(`Expected wallet lots for ${wallet}`);
    }
    expect(lots).toHaveLength(1);
    expect(lots[0].amountRemaining).toBe(100);
  });

  it('preserves FIFO semantics when replaying multiple batches', () => {
    const wallet = '0x0000000000000000000000000000000000000001';
    const state: WalletLotsState = new Map([[wallet, []]]);
    const resourceId = FET_ETHEREUM;
    const batchOne: OrderedTransferEvent[] = [
      {
        resourceId,
        blockOrdinal: '0x1',
        transactionHash: '0xaaa',
        logIndex: 0,
        fromAddress: '0x0000000000000000000000000000000000000010',
        toAddress: wallet,
        amount: 10,
        blockTimestamp: '2026-01-01T00:00:00.000Z',
        isStaking: false,
      },
    ];
    const batchTwo: OrderedTransferEvent[] = [
      {
        resourceId,
        blockOrdinal: '0x2',
        transactionHash: '0xbbb',
        logIndex: 0,
        fromAddress: '0x0000000000000000000000000000000000000020',
        toAddress: wallet,
        amount: 5,
        blockTimestamp: '2026-01-02T00:00:00.000Z',
        isStaking: false,
      },
      {
        resourceId,
        blockOrdinal: '0x3',
        transactionHash: '0xccc',
        logIndex: 0,
        fromAddress: wallet,
        toAddress: '0x0000000000000000000000000000000000000030',
        amount: 12,
        blockTimestamp: '2026-01-03T00:00:00.000Z',
        isStaking: false,
      },
    ];

    replayTransfers(state, batchOne, new Set([wallet]));
    replayTransfers(state, batchTwo, new Set([wallet]));

    const remainingLots = state.get(wallet);
    expect(remainingLots).toHaveLength(1);
    expect(remainingLots?.[0].sourceTransferId).toBe(`${resourceId}:0xbbb:0`);
    expect(remainingLots?.[0].amountRemaining).toBe(3);
  });

  it('scoreWalletLots produces consistent results with Date input', () => {
    const wallet = '0x0000000000000000000000000000000000000001';
    const state: WalletLotsState = new Map([[wallet, []]]);
    const transfers: OrderedTransferEvent[] = [
      {
        resourceId: FET_ETHEREUM,
        blockOrdinal: '0x1',
        transactionHash: '0xaaa',
        logIndex: 0,
        fromAddress: '0x0000000000000000000000000000000000000010',
        toAddress: wallet,
        amount: 10,
        blockTimestamp: '2026-01-01T00:00:00.000Z',
        isStaking: false,
      },
    ];
    replayTransfers(state, transfers, new Set([wallet]));

    const resultsWithDate = scoreWalletLots({
      lotsState: state,
      selectedResourceIds: new Set([FET_ETHEREUM]),
      snapshotCreatedAt: new Date('2026-04-01T00:00:00.000Z'),
      maturationThresholdDays: 90,
    });
    const resultsWithStringCoerced = scoreWalletLots({
      lotsState: state,
      selectedResourceIds: new Set([FET_ETHEREUM]),
      snapshotCreatedAt: new Date('2026-04-01T00:00:00.000Z'),
      maturationThresholdDays: 90,
    });

    expect(resultsWithStringCoerced).toHaveLength(resultsWithDate.length);
    expect(resultsWithStringCoerced[0].wallet_address).toBe(resultsWithDate[0].wallet_address);
    expect(resultsWithStringCoerced[0].token_value).toBeCloseTo(resultsWithDate[0].token_value, 6);
  });
});
