import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseCsv, toCsv } from '../utils/csv.js';
import { createInMemoryStorage, type InMemoryStorage } from '../utils/in-memory-storage.js';
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

const { computeCustomScore } = await import('../../../src/activities/typescript/algorithms/custom-score/compute.js');

const SNAPSHOT_ID = 'snap-custom-e2e';

const DIDS_KEY = 'uploads/dids.json';
const VOTES_A = 'uploads/votes-a.csv';
const WALLETS_A = 'uploads/wallet-collections-a.csv';
const VOTES_B = 'uploads/votes-b.csv';
const WALLETS_B = 'uploads/wallet-collections-b.csv';

/** 11 rows spanning every category → normalized entropy 1. */
function uniformVotes(collectionId: string): Array<[string, string, string]> {
  return ['skip', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map(
    (answer, i) => [collectionId, `q${i}`, answer] as [string, string, string],
  );
}

/** 3 identical votes → entropy 0. */
function flatVotes(collectionId: string): Array<[string, string, string]> {
  return [
    [collectionId, 'q1', '5'],
    [collectionId, 'q2', '5'],
    [collectionId, 'q3', '5'],
  ];
}

/**
 * Two real voting_engagement children sharing one DID set (a, b, c):
 *  - child 1 (weight 1): a→1, b→0, c→0 (c has no collection).
 *  - child 2 (weight 3): a→0, b→1, c→0.
 * With normalization 'none' (normalized = raw) and total weight 4:
 *  - composite(a) = (1×1 + 0×3)/4 = 0.25
 *  - composite(b) = (0×1 + 1×3)/4 = 0.75
 *  - composite(c) = 0 (zero-filled in both children).
 */
function seedInputs(storage: InMemoryStorage): void {
  storage.seed(
    DIDS_KEY,
    JSON.stringify({
      'did:plc:a': { userWallets: [{ address: '0xa', chain: 'ethereum' }] },
      'did:plc:b': { userWallets: [{ address: '0xb', chain: 'ethereum' }] },
      'did:plc:c': { userWallets: [{ address: '0xc', chain: 'ethereum' }] }, // no collection → 0
    }),
  );

  storage.seed(
    WALLETS_A,
    toCsv(
      ['collection_id', 'address'],
      [
        ['col-a-a', '0xa'],
        ['col-a-b', '0xb'],
      ],
    ),
  );
  storage.seed(
    VOTES_A,
    toCsv(['collection_id', 'question_id', 'answer'], [...uniformVotes('col-a-a'), ...flatVotes('col-a-b')]),
  );

  storage.seed(
    WALLETS_B,
    toCsv(
      ['collection_id', 'address'],
      [
        ['col-b-a', '0xa'],
        ['col-b-b', '0xb'],
      ],
    ),
  );
  storage.seed(
    VOTES_B,
    toCsv(['collection_id', 'question_id', 'answer'], [...flatVotes('col-b-a'), ...uniformVotes('col-b-b')]),
  );
}

function buildCustomSnapshot() {
  return buildSnapshot({
    id: SNAPSHOT_ID,
    key: 'custom_score',
    version: '1.0.0',
    inputs: [
      { key: 'dids', value: DIDS_KEY },
      {
        key: 'sub_algorithms',
        value: [
          {
            algorithm_key: 'voting_engagement',
            algorithm_version: '1.0.0',
            weight: 1,
            inputs: [
              { key: 'votes', value: VOTES_A },
              { key: 'wallet_collections', value: WALLETS_A },
            ],
          },
          {
            algorithm_key: 'voting_engagement',
            algorithm_version: '1.0.0',
            weight: 3,
            inputs: [
              { key: 'votes', value: VOTES_B },
              { key: 'wallet_collections', value: WALLETS_B },
            ],
          },
        ],
      },
      { key: 'normalization_method', value: 'none' },
      { key: 'missing_score_strategy', value: 'zero' },
    ],
  });
}

interface CompositeDetails {
  snapshot_id: string;
  normalization_method: string;
  missing_score_strategy: string;
  total_child_weight: number;
  dids: Array<{
    did: string;
    final_composite_score: number;
    child_scores: Array<{
      algorithm_key: string;
      algorithm_version: string;
      raw_score: number;
      normalized_score: number;
      child_weight: number;
      weighted_contribution: number;
    }>;
  }>;
}

describe('custom_score (e2e)', () => {
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = createInMemoryStorage();
    seedInputs(storage);
  });

  it('runs real children, writes their intermediate CSVs, and returns composite output keys', async () => {
    const result = await computeCustomScore(buildCustomSnapshot(), storage);

    expect(result).toEqual({
      outputs: {
        composite_score: `snapshots/${SNAPSHOT_ID}/composite_score.csv`,
        composite_score_details: `snapshots/${SNAPSHOT_ID}/composite_score_details.json`,
      },
    });

    // Each child wrote its own voting_engagement CSV under its suffixed snapshot id.
    expect(storage.has(`snapshots/${SNAPSHOT_ID}__custom_score_child_1_voting_engagement/voting_engagement.csv`)).toBe(
      true,
    );
    expect(storage.has(`snapshots/${SNAPSHOT_ID}__custom_score_child_2_voting_engagement/voting_engagement.csv`)).toBe(
      true,
    );
  });

  it('combines weighted child scores into the composite CSV', async () => {
    const { outputs } = await computeCustomScore(buildCustomSnapshot(), storage);

    const rows = parseCsv(storage.readText(outputs.composite_score as string) as string);
    expect(rows).toEqual([
      { did: 'did:plc:a', composite_score: '0.25' }, // (1×1 + 0×3)/4
      { did: 'did:plc:b', composite_score: '0.75' }, // (0×1 + 1×3)/4
      { did: 'did:plc:c', composite_score: '0' }, // zero-filled in both children
    ]);
  });

  it('writes per-DID child breakdown and run config in the details JSON', async () => {
    const { outputs } = await computeCustomScore(buildCustomSnapshot(), storage);
    const details = storage.readJson<CompositeDetails>(outputs.composite_score_details as string);

    expect(details).toMatchObject({
      snapshot_id: SNAPSHOT_ID,
      normalization_method: 'none',
      missing_score_strategy: 'zero',
      total_child_weight: 4,
    });
    expect(details.dids.map((d) => d.did)).toEqual(['did:plc:a', 'did:plc:b', 'did:plc:c']);

    const a = details.dids.find((d) => d.did === 'did:plc:a');
    expect(a?.final_composite_score).toBe(0.25);
    expect(a?.child_scores).toEqual([
      {
        algorithm_key: 'voting_engagement',
        algorithm_version: '1.0.0',
        raw_score: 1,
        normalized_score: 1,
        child_weight: 1,
        weighted_contribution: 0.25,
      },
      {
        algorithm_key: 'voting_engagement',
        algorithm_version: '1.0.0',
        raw_score: 0,
        normalized_score: 0,
        child_weight: 3,
        weighted_contribution: 0,
      },
    ]);

    const c = details.dids.find((d) => d.did === 'did:plc:c');
    expect(c?.final_composite_score).toBe(0);
    expect(c?.child_scores.every((s) => s.raw_score === 0 && s.weighted_contribution === 0)).toBe(true);
  });
});

describe('custom_score (e2e) — edge cases', () => {
  it('min_max normalization collapses an all-equal child vector to zero', async () => {
    const storage = createInMemoryStorage();
    storage.seed(
      'uploads/dids.json',
      JSON.stringify({
        'did:plc:a': { userWallets: [{ address: '0xa', chain: 'ethereum' }] },
        'did:plc:b': { userWallets: [{ address: '0xb', chain: 'ethereum' }] },
      }),
    );
    storage.seed(
      'uploads/wc.csv',
      toCsv(
        ['collection_id', 'address'],
        [
          ['colA', '0xa'],
          ['colB', '0xb'],
        ],
      ),
    );
    // Both collections vote uniformly → both DIDs have raw engagement 1. With no
    // spread, min_max maps every score to 0 (whereas 'none' would keep them at 1).
    storage.seed(
      'uploads/v.csv',
      toCsv(['collection_id', 'question_id', 'answer'], [...uniformVotes('colA'), ...uniformVotes('colB')]),
    );

    const id = 'snap-custom-minmax';
    const { outputs } = await computeCustomScore(
      buildSnapshot({
        id,
        key: 'custom_score',
        inputs: [
          { key: 'dids', value: 'uploads/dids.json' },
          {
            key: 'sub_algorithms',
            value: [
              {
                algorithm_key: 'voting_engagement',
                algorithm_version: '1.0.0',
                weight: 1,
                inputs: [
                  { key: 'votes', value: 'uploads/v.csv' },
                  { key: 'wallet_collections', value: 'uploads/wc.csv' },
                ],
              },
            ],
          },
          { key: 'normalization_method', value: 'min_max' },
          { key: 'missing_score_strategy', value: 'zero' },
        ],
      }),
      storage,
    );

    const rows = parseCsv(storage.readText(outputs.composite_score as string) as string);
    expect(rows).toEqual([
      { did: 'did:plc:a', composite_score: '0' },
      { did: 'did:plc:b', composite_score: '0' },
    ]);

    const details = storage.readJson<CompositeDetails>(outputs.composite_score_details as string);
    const a = details.dids.find((d) => d.did === 'did:plc:a');
    expect(a?.child_scores[0]).toMatchObject({ raw_score: 1, normalized_score: 0, weighted_contribution: 0 });
  });

  it('throws on an unsupported missing_score_strategy', async () => {
    const storage = createInMemoryStorage();
    const snapshot = buildSnapshot({
      id: 'snap-custom-bad',
      key: 'custom_score',
      inputs: [
        { key: 'dids', value: 'uploads/dids.json' },
        {
          key: 'sub_algorithms',
          value: [{ algorithm_key: 'voting_engagement', algorithm_version: '1.0.0', weight: 1, inputs: [] }],
        },
        { key: 'normalization_method', value: 'none' },
        { key: 'missing_score_strategy', value: 'exclude' },
      ],
    });

    await expect(computeCustomScore(snapshot, storage)).rejects.toThrow('Unsupported missing_score_strategy: exclude');
  });
});
