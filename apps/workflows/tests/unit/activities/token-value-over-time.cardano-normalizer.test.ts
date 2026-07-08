import { describe, expect, it } from 'vitest';

import { normalizeCardanoTransactions } from '../../../src/activities/typescript/algorithms/token-value-over-time/normalizers/index.js';
import type { ResourceId } from '../../../src/activities/typescript/algorithms/token-value-over-time/types.js';

const FET_CARDANO_UNIT = 'e824c0011176f0926ad51f492bcc63ac6a03a589653520839dc7e3d9464554';
const RESOURCE_ID: ResourceId = `cardano:${FET_CARDANO_UNIT}`;
const SENDER = 'addr1sender';
const RECEIVER = 'addr1receiver';

const tx = {
  tx_hash: 'tx1',
  block_height: 1000,
  block_time: 1_700_000_000,
  inputs: [{ address: SENDER, amounts: [{ unit: FET_CARDANO_UNIT, quantity: '1000000000' }] }],
  outputs: [
    { address: RECEIVER, output_index: 0, amounts: [{ unit: FET_CARDANO_UNIT, quantity: '43335000' }] },
    { address: SENDER, output_index: 1, amounts: [{ unit: FET_CARDANO_UNIT, quantity: '956665000' }] },
  ],
};

describe('normalizeCardanoTransactions decimals', () => {
  it('converts raw Blockfrost sub-unit quantities into token units', () => {
    const events = normalizeCardanoTransactions([tx], RESOURCE_ID, FET_CARDANO_UNIT, new Set([SENDER, RECEIVER]), 6);

    // Sender net: -1000 + 956.665 = -43.335 FET; receiver net: +43.335 FET.
    expect(events).toHaveLength(2);
    const spend = events.find((e) => e.fromAddress === SENDER);
    const receive = events.find((e) => e.toAddress === RECEIVER);
    expect(spend?.amount).toBeCloseTo(43.335, 9);
    expect(receive?.amount).toBeCloseTo(43.335, 9);
  });

  it('defaults to raw units when no decimals are configured', () => {
    const events = normalizeCardanoTransactions([tx], RESOURCE_ID, FET_CARDANO_UNIT, new Set([RECEIVER]));

    expect(events).toHaveLength(1);
    expect(events[0].amount).toBe(43_335_000);
  });
});
