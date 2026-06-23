import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseCsv, toCsv } from '../utils/csv.js';
import { createInMemoryStorage, type InMemoryStorage } from '../utils/in-memory-storage.js';
import { buildSnapshot } from '../utils/snapshot.js';

// Only the runtime boundary is mocked — the Temporal activity Context (logger +
// heartbeat) and the env-backed config. Everything else (input parsing, the
// wallet→collection→DID join, the entropy math, CSV/JSON serialization and the
// storage round-trip) runs for real against the in-memory Storage fake.
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

const { computeVotingEngagement } = await import(
  '../../../src/activities/typescript/algorithms/voting-engagement/compute.js'
);

const SNAPSHOT_ID = 'snap-voting-e2e';
const DIDS_KEY = 'uploads/dids.json';
const VOTES_KEY = 'uploads/votes.csv';
const WALLET_COLLECTIONS_KEY = 'uploads/wallet_collections.csv';

const LOG2_11 = Math.log2(11); // entropy of a uniform vote over the 11 categories

/**
 * Seeds the three inputs voting_engagement reads:
 *  - alice: one vote per category (uniform) → normalized entropy = 1.
 *  - bob:   three identical votes           → entropy 0 → score 0 (but matched).
 *  - carol: a wallet with no collection mapping → no votes → score 0, unmatched.
 * Plus an invalid answer (counts as invalid) and a vote from a collection outside
 * the resolved allowlist (silently skipped, counts as neither valid nor invalid).
 */
function seedInputs(storage: InMemoryStorage): void {
  storage.seed(
    DIDS_KEY,
    JSON.stringify({
      'did:plc:alice': { userWallets: [{ address: '0xAAA', chain: 'ethereum' }] },
      'did:plc:bob': { userWallets: [{ address: '0xBBB', chain: 'ethereum' }] },
      'did:plc:carol': { userWallets: [{ address: '0xCCC', chain: 'ethereum' }] },
    }),
  );

  storage.seed(
    WALLET_COLLECTIONS_KEY,
    toCsv(
      ['collection_id', 'address', 'network'],
      [
        ['voter-alice', '0xaaa', 'ethereum'],
        ['voter-bob', '0xbbb', 'ethereum'],
        // carol's wallet 0xccc is intentionally absent → carol resolves to no collections.
      ],
    ),
  );

  storage.seed(
    VOTES_KEY,
    toCsv(
      ['collection_id', 'question_id', 'answer'],
      [
        ['voter-alice', 'q1', 'skip'],
        ['voter-alice', 'q2', '1'],
        ['voter-alice', 'q3', '2'],
        ['voter-alice', 'q4', '3'],
        ['voter-alice', 'q5', '4'],
        ['voter-alice', 'q6', '5'],
        ['voter-alice', 'q7', '6'],
        ['voter-alice', 'q8', '7'],
        ['voter-alice', 'q9', '8'],
        ['voter-alice', 'q10', '9'],
        ['voter-alice', 'q11', '10'],
        ['voter-alice', 'q12', 'maybe'], // invalid answer → invalidVotes += 1
        ['voter-bob', 'q1', '5'],
        ['voter-bob', 'q2', '5'],
        ['voter-bob', 'q3', '5'],
        ['voter-unknown', 'q1', '5'], // not in allowlist → skipped, uncounted
      ],
    ),
  );
}

function buildVotingSnapshot() {
  return buildSnapshot({
    id: SNAPSHOT_ID,
    key: 'voting_engagement',
    version: '1.0.0',
    inputs: [
      { key: 'dids', value: DIDS_KEY },
      { key: 'votes', value: VOTES_KEY },
      { key: 'wallet_collections', value: WALLET_COLLECTIONS_KEY },
    ],
  });
}

describe('voting_engagement (e2e)', () => {
  let storage: InMemoryStorage;

  beforeEach(() => {
    storage = createInMemoryStorage();
    seedInputs(storage);
  });

  it('returns the snapshot-scoped output keys for the result CSV and details JSON', async () => {
    const result = await computeVotingEngagement(buildVotingSnapshot(), storage);

    expect(result).toEqual({
      outputs: {
        voting_engagement: `snapshots/${SNAPSHOT_ID}/voting_engagement.csv`,
        voting_engagement_details: `snapshots/${SNAPSHOT_ID}/voting_engagement_details.json`,
      },
    });
    expect(storage.has(`snapshots/${SNAPSHOT_ID}/voting_engagement.csv`)).toBe(true);
    expect(storage.has(`snapshots/${SNAPSHOT_ID}/voting_engagement_details.json`)).toBe(true);
  });

  it('writes one CSV row per DID, sorted, with normalized-entropy scores', async () => {
    const { outputs } = await computeVotingEngagement(buildVotingSnapshot(), storage);

    const csv = storage.readText(outputs.voting_engagement as string);
    expect(csv).toBeDefined();
    const rows = parseCsv(csv as string);

    expect(rows).toEqual([
      { did: 'did:plc:alice', voting_engagement: '1' }, // uniform over 11 categories → 1
      { did: 'did:plc:bob', voting_engagement: '0' }, // all identical votes → 0
      { did: 'did:plc:carol', voting_engagement: '0' }, // no resolved collections → 0
    ]);
  });

  it('writes a details JSON with per-DID distribution and run metrics', async () => {
    const { outputs } = await computeVotingEngagement(buildVotingSnapshot(), storage);

    const details = storage.readJson<{
      dids: Array<{
        did: string;
        collection_ids: string[];
        total_votes: number;
        vote_distribution: Record<string, number>;
        entropy: number;
        voting_engagement: number;
      }>;
      metadata: {
        snapshot_id: string;
        computed_at: string;
        dids: { provided_ids: string[]; matched_ids: string[]; unmatched_ids: string[] };
        metrics: {
          total_votes_in_file: number;
          valid_votes: number;
          invalid_votes: number;
          targeted_voter_ids: number;
          dids_with_votes: number;
        };
      };
    }>(outputs.voting_engagement_details as string);

    expect(details.dids.map((d) => d.did)).toEqual(['did:plc:alice', 'did:plc:bob', 'did:plc:carol']);

    const alice = details.dids[0];
    expect(alice.collection_ids).toEqual(['voter-alice']);
    expect(alice.total_votes).toBe(11);
    expect(alice.vote_distribution).toEqual({
      skip: 1,
      '1': 1,
      '2': 1,
      '3': 1,
      '4': 1,
      '5': 1,
      '6': 1,
      '7': 1,
      '8': 1,
      '9': 1,
      '10': 1,
    });
    expect(alice.entropy).toBeCloseTo(LOG2_11, 6);
    expect(alice.voting_engagement).toBe(1);

    const bob = details.dids[1];
    expect(bob.total_votes).toBe(3);
    expect(bob.vote_distribution['5']).toBe(3);
    expect(bob.entropy).toBe(0);
    expect(bob.voting_engagement).toBe(0);

    const carol = details.dids[2];
    expect(carol.collection_ids).toEqual([]);
    expect(carol.total_votes).toBe(0);
    expect(carol.voting_engagement).toBe(0);

    expect(details.metadata.snapshot_id).toBe(SNAPSHOT_ID);
    expect(() => new Date(details.metadata.computed_at).toISOString()).not.toThrow();
    expect(details.metadata.dids).toEqual({
      provided_ids: ['did:plc:alice', 'did:plc:bob', 'did:plc:carol'],
      matched_ids: ['did:plc:alice', 'did:plc:bob'],
      unmatched_ids: ['did:plc:carol'],
    });
    expect(details.metadata.metrics).toEqual({
      total_votes_in_file: 16,
      valid_votes: 14,
      invalid_votes: 1,
      targeted_voter_ids: 2,
      dids_with_votes: 2,
    });
  });
});

describe('voting_engagement (e2e) — edge cases', () => {
  it("aggregates votes across a DID's multiple wallets and collections", async () => {
    const storage = createInMemoryStorage();
    storage.seed(
      'uploads/dids.json',
      JSON.stringify({
        'did:plc:multi': {
          userWallets: [
            { address: '0x1', chain: 'ethereum' },
            { address: '0x2', chain: 'ethereum' },
          ],
        },
      }),
    );
    storage.seed(
      'uploads/wc.csv',
      toCsv(
        ['collection_id', 'address'],
        [
          ['colX', '0x1'],
          ['colY', '0x2'],
        ],
      ),
    );
    // colX covers 6 categories, colY the other 5 → combined = all 11 distinct → entropy max → 1.
    storage.seed(
      'uploads/v.csv',
      toCsv(
        ['collection_id', 'question_id', 'answer'],
        [
          ['colX', 'q1', 'skip'],
          ['colX', 'q2', '1'],
          ['colX', 'q3', '2'],
          ['colX', 'q4', '3'],
          ['colX', 'q5', '4'],
          ['colX', 'q6', '5'],
          ['colY', 'q7', '6'],
          ['colY', 'q8', '7'],
          ['colY', 'q9', '8'],
          ['colY', 'q10', '9'],
          ['colY', 'q11', '10'],
        ],
      ),
    );

    const snapshot = buildSnapshot({
      id: 'snap-ve-multi',
      key: 'voting_engagement',
      inputs: [
        { key: 'dids', value: 'uploads/dids.json' },
        { key: 'votes', value: 'uploads/v.csv' },
        { key: 'wallet_collections', value: 'uploads/wc.csv' },
      ],
    });

    const { outputs } = await computeVotingEngagement(snapshot, storage);

    const rows = parseCsv(storage.readText(outputs.voting_engagement as string) as string);
    expect(rows).toEqual([{ did: 'did:plc:multi', voting_engagement: '1' }]);

    const details = storage.readJson<{
      dids: Array<{ did: string; collection_ids: string[]; total_votes: number }>;
    }>(outputs.voting_engagement_details as string);
    expect([...details.dids[0].collection_ids].sort()).toEqual(['colX', 'colY']);
    expect(details.dids[0].total_votes).toBe(11); // votes pooled across both collections
  });

  it('throws when the required votes input is missing', async () => {
    const storage = createInMemoryStorage();
    storage.seed('uploads/dids.json', JSON.stringify({ 'did:plc:a': { userWallets: [] } }));

    const snapshot = buildSnapshot({
      id: 'snap-ve-missing',
      key: 'voting_engagement',
      inputs: [
        { key: 'dids', value: 'uploads/dids.json' },
        { key: 'wallet_collections', value: 'uploads/wc.csv' },
        // 'votes' intentionally omitted
      ],
    });

    await expect(computeVotingEngagement(snapshot, storage)).rejects.toThrow('Missing required "votes" input');
  });
});
