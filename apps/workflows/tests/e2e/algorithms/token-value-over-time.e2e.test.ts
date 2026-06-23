import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { parseCsv } from '../utils/csv.js';
import { createInMemoryStorage, type InMemoryStorage } from '../utils/in-memory-storage.js';
import type { OnchainPostgres } from '../utils/onchain-postgres.js';
import { buildSnapshot } from '../utils/snapshot.js';

vi.mock('@temporalio/activity', () => ({
  Context: {
    current: () => ({
      log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
      heartbeat: vi.fn(),
    }),
  },
}));

vi.mock('../../../src/config/index.js', async () => ({
  default: (await import('../utils/config-mock.js')).testConfig,
}));

const { computeTokenValueOverTime } = await import(
  '../../../src/activities/typescript/algorithms/token-value-over-time/compute.js'
);

// Needs Docker; gated like the onchain-data integration tests so the free-tier CI
// (no Postgres) stays green. Run with: RUN_POSTGRES_TESTS=true pnpm --filter
// @reputo/workflows test:e2e
const describeMaybe = process.env.RUN_POSTGRES_TESTS === 'true' ? describe : describe.skip;

const SNAPSHOT_ID = 'snap-tvt-e2e';
const SNAPSHOT_CREATED_AT = '2026-01-01T00:00:00.000Z';
const SNAPSHOT_MS = Date.parse(SNAPSHOT_CREATED_AT);
const MS_PER_DAY = 86_400_000;
const ago = (days: number) => new Date(SNAPSHOT_MS - days * MS_PER_DAY).toISOString();

// FET on Ethereum, verbatim from the registry resource catalog. The read repo
// filters `asset_identifier = $2` WITHOUT lowercasing, so seed it exactly.
const FET_ETH = '0xaea46A60368A7bD060eec7DF8CBa43b7EF41Ad85';
const RESOURCE_ID = `ethereum:${FET_ETH.toLowerCase()}`;
const STAKING_1 = '0xcb85b101c4822a4e3abca20e57f1dff0e2673475'; // fet_staking_1 (lowercased)

const ALICE_WALLET = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BOB_WALLET = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const EXTERNAL = '0xcccccccccccccccccccccccccccccccccccccccc';
const DIDS_KEY = 'uploads/dids.json';

/**
 * alice's wallet history (FIFO, maturation 90d, scored at SNAPSHOT_CREATED_AT):
 *   t1 +100 (180d ago)  → lot L1
 *   t2  -30 (from alice) → consumes L1 → L1 = 70
 *   t3  +50 (45d ago)    → lot L2
 *   t4  self-transfer    → skipped
 *   t5  zero amount      → skipped
 *   t6  → staking contract → skipped
 * Final: L1 70 × weight 1 (age 180 ≥ 90) = 70; L2 50 × weight 0.5 (age 45/90) = 25.
 *   alice token_value = 95. bob has no transfers → 0.
 */
const TRANSFERS = [
  {
    uniqueId: 't1',
    blockNum: '1',
    hash: '0xh1',
    from: EXTERNAL,
    to: ALICE_WALLET,
    amount: 100,
    blockTimestamp: ago(180),
  },
  {
    uniqueId: 't2',
    blockNum: '2',
    hash: '0xh2',
    from: ALICE_WALLET,
    to: EXTERNAL,
    amount: 30,
    blockTimestamp: ago(100),
  },
  {
    uniqueId: 't3',
    blockNum: '3',
    hash: '0xh3',
    from: EXTERNAL,
    to: ALICE_WALLET,
    amount: 50,
    blockTimestamp: ago(45),
  },
  {
    uniqueId: 't4',
    blockNum: '4',
    hash: '0xh4',
    from: ALICE_WALLET,
    to: ALICE_WALLET,
    amount: 10,
    blockTimestamp: ago(40),
  },
  { uniqueId: 't5', blockNum: '5', hash: '0xh5', from: EXTERNAL, to: ALICE_WALLET, amount: 0, blockTimestamp: ago(35) },
  {
    uniqueId: 't6',
    blockNum: '6',
    hash: '0xh6',
    from: ALICE_WALLET,
    to: STAKING_1,
    amount: 20,
    blockTimestamp: ago(30),
  },
];

function seedStorage(storage: InMemoryStorage): void {
  storage.seed(
    DIDS_KEY,
    JSON.stringify({
      'did:plc:alice': { userWallets: [{ address: ALICE_WALLET, chain: 'ethereum' }] },
      'did:plc:bob': { userWallets: [{ address: BOB_WALLET, chain: 'ethereum' }] },
    }),
  );
}

function buildTvtSnapshot() {
  return buildSnapshot({
    id: SNAPSHOT_ID,
    key: 'token_value_over_time',
    version: '1.0.0',
    createdAt: SNAPSHOT_CREATED_AT,
    inputs: [
      { key: 'maturation_threshold_days', value: 90 },
      { key: 'selected_resources', value: [{ chain: 'ethereum', resource_key: 'fet_token' }] },
      { key: 'dids', value: DIDS_KEY },
    ],
  });
}

interface TvtDetails {
  dids: Array<{
    did: string;
    token_value: number;
    wallets: Array<{
      wallet_address: string;
      token_value: number;
      lots: Array<{
        resource_id: string;
        source_transfer_id: string;
        amount_remaining: number;
        age_days: number;
        weight: number;
        lot_value: number;
      }>;
    }>;
  }>;
  metadata: {
    snapshot_id: string;
    maturation_threshold_days: number;
    selected_resource_ids: string[];
    did_count: number;
    target_wallet_count: number;
    transfer_count: number;
    replay: { processed: number; skippedZeroAmount: number; skippedSelfTransfers: number; skippedStaking: number };
  };
}

describeMaybe('token_value_over_time (e2e)', () => {
  let pg: OnchainPostgres;
  let storage: InMemoryStorage;

  beforeAll(async () => {
    const { startOnchainPostgres } = await import('../utils/onchain-postgres.js');
    pg = await startOnchainPostgres(FET_ETH);
    await pg.seedEvmTransfers(TRANSFERS);
    process.env.ONCHAIN_DATABASE_URL = pg.databaseUrl;

    storage = createInMemoryStorage();
    seedStorage(storage);
  });

  afterAll(async () => {
    await pg?.cleanup();
  });

  it('returns snapshot-scoped output keys', async () => {
    const result = await computeTokenValueOverTime(buildTvtSnapshot(), storage);

    expect(result).toEqual({
      outputs: {
        token_value_over_time: `snapshots/${SNAPSHOT_ID}/token_value_over_time.csv`,
        token_value_over_time_details: `snapshots/${SNAPSHOT_ID}/token_value_over_time_details.json`,
      },
    });
  });

  it('scores FIFO lots with linear maturation weight', async () => {
    const { outputs } = await computeTokenValueOverTime(buildTvtSnapshot(), storage);

    const rows = parseCsv(storage.readText(outputs.token_value_over_time as string) as string);
    expect(rows).toEqual([
      { did: 'did:plc:alice', token_value: '95' }, // 70×1 + 50×0.5
      { did: 'did:plc:bob', token_value: '0' },
    ]);
  });

  it('records per-lot detail and replay skip counters in the JSON', async () => {
    const { outputs } = await computeTokenValueOverTime(buildTvtSnapshot(), storage);
    const details = storage.readJson<TvtDetails>(outputs.token_value_over_time_details as string);

    expect(details.metadata).toMatchObject({
      snapshot_id: SNAPSHOT_ID,
      maturation_threshold_days: 90,
      selected_resource_ids: [RESOURCE_ID],
      did_count: 2,
      target_wallet_count: 2,
      transfer_count: 6,
      replay: { processed: 6, skippedZeroAmount: 1, skippedSelfTransfers: 1, skippedStaking: 1 },
    });

    const alice = details.dids.find((d) => d.did === 'did:plc:alice');
    expect(alice?.token_value).toBe(95);
    expect(alice?.wallets).toHaveLength(1);
    expect(alice?.wallets[0].wallet_address).toBe(ALICE_WALLET);

    const lots = alice?.wallets[0].lots ?? [];
    expect(lots).toEqual([
      {
        resource_id: RESOURCE_ID,
        source_transfer_id: `${RESOURCE_ID}:0xh1:0`,
        amount_remaining: 70, // 100 received, 30 consumed FIFO
        age_days: 180,
        weight: 1,
        lot_value: 70,
      },
      {
        resource_id: RESOURCE_ID,
        source_transfer_id: `${RESOURCE_ID}:0xh3:0`,
        amount_remaining: 50,
        age_days: 45,
        weight: 0.5,
        lot_value: 25,
      },
    ]);

    // bob is a target wallet with no transfers → his wallet is scored at 0 with no lots.
    const bob = details.dids.find((d) => d.did === 'did:plc:bob');
    expect(bob?.token_value).toBe(0);
    expect(bob?.wallets).toEqual([{ wallet_address: BOB_WALLET, token_value: 0, lots: [] }]);
  });

  it('credits a wallet shared by multiple DIDs to each of them', async () => {
    const SHARED = '0xdddddddddddddddddddddddddddddddddddddddd';
    await pg.seedEvmTransfers([
      {
        uniqueId: 's1',
        blockNum: '1',
        hash: '0xs1',
        from: EXTERNAL,
        to: SHARED,
        amount: 100,
        blockTimestamp: ago(200),
      },
    ]);
    storage.seed(
      'uploads/dids-shared.json',
      JSON.stringify({
        'did:plc:x': { userWallets: [{ address: SHARED, chain: 'ethereum' }] },
        'did:plc:y': { userWallets: [{ address: SHARED, chain: 'ethereum' }] },
      }),
    );

    const { outputs } = await computeTokenValueOverTime(
      buildSnapshot({
        id: 'snap-tvt-shared',
        key: 'token_value_over_time',
        createdAt: SNAPSHOT_CREATED_AT,
        inputs: [
          { key: 'maturation_threshold_days', value: 90 },
          { key: 'selected_resources', value: [{ chain: 'ethereum', resource_key: 'fet_token' }] },
          { key: 'dids', value: 'uploads/dids-shared.json' },
        ],
      }),
      storage,
    );

    const rows = parseCsv(storage.readText(outputs.token_value_over_time as string) as string);
    expect(rows).toEqual([
      { did: 'did:plc:x', token_value: '100' }, // both DIDs link the same wallet → both score 100
      { did: 'did:plc:y', token_value: '100' },
    ]);
  });

  it('treats maturation_threshold_days = 0 as fully matured (weight 1)', async () => {
    const WALLET = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    await pg.seedEvmTransfers([
      { uniqueId: 'm1', blockNum: '1', hash: '0xm1', from: EXTERNAL, to: WALLET, amount: 40, blockTimestamp: ago(10) },
    ]);
    storage.seed(
      'uploads/dids-mat0.json',
      JSON.stringify({ 'did:plc:m': { userWallets: [{ address: WALLET, chain: 'ethereum' }] } }),
    );

    const { outputs } = await computeTokenValueOverTime(
      buildSnapshot({
        id: 'snap-tvt-mat0',
        key: 'token_value_over_time',
        createdAt: SNAPSHOT_CREATED_AT,
        inputs: [
          { key: 'maturation_threshold_days', value: 0 },
          { key: 'selected_resources', value: [{ chain: 'ethereum', resource_key: 'fet_token' }] },
          { key: 'dids', value: 'uploads/dids-mat0.json' },
        ],
      }),
      storage,
    );

    const rows = parseCsv(storage.readText(outputs.token_value_over_time as string) as string);
    expect(rows).toEqual([{ did: 'did:plc:m', token_value: '40' }]); // young lot, but maturation 0 → full value

    const details = storage.readJson<TvtDetails>(outputs.token_value_over_time_details as string);
    const lot = details.dids[0].wallets[0].lots[0];
    expect(lot.weight).toBe(1);
    expect(lot.age_days).toBe(10);
    expect(lot.lot_value).toBe(40);
  });
});
