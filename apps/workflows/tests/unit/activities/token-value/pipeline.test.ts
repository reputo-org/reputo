import { describe, expect, it } from 'vitest';
import { applyTransfer } from '../../../../src/activities/typescript/algorithms/token-value-over-time/pipeline/apply-transfer.js';
import {
  consumeLotsFifo,
  pushLot,
} from '../../../../src/activities/typescript/algorithms/token-value-over-time/pipeline/fifo-lots.js';
import { scoreWalletLots } from '../../../../src/activities/typescript/algorithms/token-value-over-time/pipeline/score-wallet.js';
import {
  computeLinearWeight,
  computeLotAgeDays,
} from '../../../../src/activities/typescript/algorithms/token-value-over-time/pipeline/weight.js';
import type {
  OrderedTransferEvent,
  ReplayStats,
  WalletLot,
  WalletLotsState,
} from '../../../../src/activities/typescript/algorithms/token-value-over-time/types.js';

const lot = (overrides: Partial<WalletLot> = {}): WalletLot => ({
  resourceId: 'ethereum:0x1',
  amountRemaining: 100,
  receivedAt: '2026-01-01T00:00:00Z',
  sourceTransferId: 'ethereum:0xabc:0',
  ...overrides,
});

const transfer = (overrides: Partial<OrderedTransferEvent> = {}): OrderedTransferEvent => ({
  resourceId: 'ethereum:0x1',
  blockOrdinal: '1',
  transactionHash: '0xabc',
  logIndex: 0,
  fromAddress: null,
  toAddress: '0xreceiver',
  amount: 100,
  blockTimestamp: '2026-01-01T00:00:00Z',
  isStaking: false,
  ...overrides,
});

const emptyStats = (): ReplayStats => ({
  processed: 0,
  skippedZeroAmount: 0,
  skippedSelfTransfers: 0,
  skippedStaking: 0,
});

describe('fifo-lots', () => {
  it('ignores lots with zero or negative remaining amount', () => {
    const queue: WalletLot[] = [];
    pushLot(queue, lot({ amountRemaining: 0 }));
    pushLot(queue, lot({ amountRemaining: -5 }));
    expect(queue).toHaveLength(0);
  });

  it('consumes lots FIFO and shifts off fully drained ones', () => {
    const queue: WalletLot[] = [lot({ amountRemaining: 40 }), lot({ amountRemaining: 100 })];
    const remaining = consumeLotsFifo(queue, 60);
    expect(remaining).toBe(0);
    expect(queue).toHaveLength(1);
    expect(queue[0].amountRemaining).toBe(80);
  });

  it('returns any unconsumed amount when the queue is exhausted', () => {
    const queue: WalletLot[] = [lot({ amountRemaining: 30 })];
    const remaining = consumeLotsFifo(queue, 50);
    expect(remaining).toBe(20);
    expect(queue).toHaveLength(0);
  });

  it('returns zero immediately for non-positive consume requests', () => {
    const queue: WalletLot[] = [lot({ amountRemaining: 30 })];
    expect(consumeLotsFifo(queue, 0)).toBe(0);
    expect(consumeLotsFifo(queue, -5)).toBe(0);
  });
});

describe('apply-transfer', () => {
  it('skips zero-amount transfers and counts them', () => {
    const state: WalletLotsState = new Map();
    const stats = emptyStats();

    applyTransfer(state, transfer({ amount: 0 }), new Set(['0xreceiver']), stats);

    expect(stats.skippedZeroAmount).toBe(1);
    expect(state.get('0xreceiver')).toBeUndefined();
  });

  it('skips self-transfers', () => {
    const state: WalletLotsState = new Map([['0xself', []]]);
    const stats = emptyStats();

    applyTransfer(state, transfer({ fromAddress: '0xself', toAddress: '0xself' }), new Set(['0xself']), stats);

    expect(stats.skippedSelfTransfers).toBe(1);
    expect(state.get('0xself')).toEqual([]);
  });

  it('skips staking transfers', () => {
    const state: WalletLotsState = new Map([['0xreceiver', []]]);
    const stats = emptyStats();

    applyTransfer(state, transfer({ isStaking: true }), new Set(['0xreceiver']), stats);

    expect(stats.skippedStaking).toBe(1);
    expect(state.get('0xreceiver')).toEqual([]);
  });

  it('adds a lot to a target receiver', () => {
    const state: WalletLotsState = new Map([['0xreceiver', []]]);
    const stats = emptyStats();

    applyTransfer(state, transfer({ amount: 50 }), new Set(['0xreceiver']), stats);

    expect(state.get('0xreceiver')).toHaveLength(1);
    expect(state.get('0xreceiver')?.[0].amountRemaining).toBe(50);
    expect(stats.processed).toBe(1);
  });

  it('drains lots from a target sender via FIFO', () => {
    const state: WalletLotsState = new Map([
      ['0xsender', [lot({ amountRemaining: 30 }), lot({ amountRemaining: 100 })]],
    ]);
    const stats = emptyStats();

    applyTransfer(
      state,
      transfer({ fromAddress: '0xsender', toAddress: null, amount: 50 }),
      new Set(['0xsender']),
      stats,
    );

    expect(state.get('0xsender')).toHaveLength(1);
    expect(state.get('0xsender')?.[0].amountRemaining).toBe(80);
  });
});

describe('weight', () => {
  it('returns zero age when no received timestamp is recorded', () => {
    expect(computeLotAgeDays(null, new Date('2026-01-01T00:00:00Z'))).toBe(0);
  });

  it('returns zero for negative ages (lot received after snapshot)', () => {
    expect(computeLotAgeDays('2026-12-01T00:00:00Z', new Date('2026-01-01T00:00:00Z'))).toBe(0);
  });

  it('measures age in days between the received and snapshot timestamps', () => {
    const age = computeLotAgeDays('2026-01-01T00:00:00Z', new Date('2026-01-11T00:00:00Z'));
    expect(age).toBe(10);
  });

  it('returns 1 when the maturation threshold is non-positive', () => {
    expect(computeLinearWeight(5, 0)).toBe(1);
    expect(computeLinearWeight(5, -1)).toBe(1);
  });

  it('returns 0 when age is non-positive', () => {
    expect(computeLinearWeight(0, 10)).toBe(0);
    expect(computeLinearWeight(-1, 10)).toBe(0);
  });

  it('linearly scales weight up to 1 at the maturation threshold', () => {
    expect(computeLinearWeight(5, 10)).toBe(0.5);
    expect(computeLinearWeight(10, 10)).toBe(1);
    expect(computeLinearWeight(15, 10)).toBe(1);
  });
});

describe('score-wallet', () => {
  it('skips lots whose resourceId is not in the selected set', () => {
    const state: WalletLotsState = new Map([
      [
        '0xwallet',
        [
          lot({ resourceId: 'ethereum:0xother', amountRemaining: 50 }),
          lot({ resourceId: 'ethereum:0xpicked', amountRemaining: 30 }),
        ],
      ],
    ]);

    const rows = scoreWalletLots({
      lotsState: state,
      selectedResourceIds: new Set(['ethereum:0xpicked']),
      snapshotCreatedAt: new Date('2026-01-11T00:00:00Z'),
      maturationThresholdDays: 10,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].lots).toHaveLength(1);
    expect(rows[0].lots[0].resource_id).toBe('ethereum:0xpicked');
  });

  it('weights lots by linear maturation and aggregates wallet total', () => {
    const state: WalletLotsState = new Map([
      ['0xwallet', [lot({ amountRemaining: 100, receivedAt: '2026-01-01T00:00:00Z' })]],
    ]);

    const rows = scoreWalletLots({
      lotsState: state,
      selectedResourceIds: new Set(['ethereum:0x1']),
      snapshotCreatedAt: new Date('2026-01-11T00:00:00Z'),
      maturationThresholdDays: 20,
    });

    expect(rows[0].token_value).toBe(50);
    expect(rows[0].lots[0].weight).toBe(0.5);
  });

  it('skips lots with zero or negative remaining amount', () => {
    const state: WalletLotsState = new Map([['0xempty', [lot({ amountRemaining: 0 })]]]);

    const rows = scoreWalletLots({
      lotsState: state,
      selectedResourceIds: new Set(['ethereum:0x1']),
      snapshotCreatedAt: new Date('2026-01-11T00:00:00Z'),
      maturationThresholdDays: 10,
    });

    expect(rows[0].token_value).toBe(0);
    expect(rows[0].lots).toHaveLength(0);
  });

  it('returns rows sorted by wallet address', () => {
    const state: WalletLotsState = new Map([
      ['0xb', [lot({ amountRemaining: 1 })]],
      ['0xa', [lot({ amountRemaining: 1 })]],
    ]);

    const rows = scoreWalletLots({
      lotsState: state,
      selectedResourceIds: new Set(['ethereum:0x1']),
      snapshotCreatedAt: new Date('2026-01-11T00:00:00Z'),
      maturationThresholdDays: 10,
    });

    expect(rows.map((r) => r.wallet_address)).toEqual(['0xa', '0xb']);
  });
});
