import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseCsv, toCsv } from '../utils/csv.js';
import { buildDeepfundingDbBytes, commentSeed, proposalSeed, reviewSeed, userSeed } from '../utils/deepfunding-db.js';
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
const FIXED_NOW = '2026-01-01T00:00:00.000Z';
const RECENT = '2025-06-01T00:00:00Z'; // ~7 months old → inside the 48-month window, tw=1

const DIDS_KEY = 'uploads/dids.json';
const VOTES_KEY = 'uploads/votes.csv';
const WALLETS_KEY = 'uploads/wallet-collections.csv';

// Children run under the parent snapshot id, so the run's single portal DB
// (written once by the dependency resolution) serves every portal child.
const DB_KEY = `snapshots/${SNAPSHOT_ID}/deepfunding.db`;

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
 * Two distinct children whose native cohorts differ. Each child normalizes its
 * own output to 0–100 and zero-fills only inside its own cohort:
 *  - voting_engagement (weight 1) scores the shared DID input (a, b, c):
 *    a→100 (uniform votes), b→0 (flat votes), c→0 (no collection).
 *  - proposal_engagement (weight 3) scores the portal users with a DID (a, b):
 *    a→100 (funded-concluded reward), b→0 (unfunded penalty is the cohort
 *    min), and c is not part of the portal cohort at all.
 */
const PORTAL_SEED = {
  users: [userSeed({ id: 1, did: 'did:plc:a' }), userSeed({ id: 2, did: 'did:plc:b' })],
  proposals: [
    proposalSeed({ id: 1, round_id: 31, proposer_id: 1, is_awarded: true, is_completed: true, created_at: RECENT }),
    proposalSeed({ id: 2, round_id: 36, proposer_id: 2, is_awarded: false, is_completed: false, created_at: RECENT }),
  ],
  reviews: [
    reviewSeed({ proposal_id: 1, review_type: 'community', overall_rating: '4' }),
    reviewSeed({ proposal_id: 1, review_type: 'community', overall_rating: '5' }),
    reviewSeed({ proposal_id: 2, review_type: 'community', overall_rating: '3' }),
  ],
};

function seedInputs(storage: InMemoryStorage, dbBytes: Buffer): void {
  storage.seed(
    DIDS_KEY,
    JSON.stringify({
      'did:plc:a': { userWallets: [{ address: '0xa', chain: 'ethereum' }] },
      'did:plc:b': { userWallets: [{ address: '0xb', chain: 'ethereum' }] },
      'did:plc:c': { userWallets: [{ address: '0xc', chain: 'ethereum' }] }, // no votes → native 0 in the voting cohort
    }),
  );

  storage.seed(
    WALLETS_KEY,
    toCsv(
      ['collection_id', 'address'],
      [
        ['col-a', '0xa'],
        ['col-b', '0xb'],
      ],
    ),
  );
  storage.seed(
    VOTES_KEY,
    toCsv(['collection_id', 'question_id', 'answer'], [...uniformVotes('col-a'), ...flatVotes('col-b')]),
  );

  storage.seed(DB_KEY, dbBytes);
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
              { key: 'votes', value: VOTES_KEY },
              { key: 'wallet_collections', value: WALLETS_KEY },
            ],
          },
          {
            algorithm_key: 'proposal_engagement',
            algorithm_version: '1.0.0',
            weight: 3,
            inputs: [
              { key: 'funded_concluded_reward_weight', value: 2 },
              { key: 'unfunded_penalty_weight', value: 1 },
              { key: 'engagement_window_months', value: 48 },
              { key: 'monthly_decay_rate_percent', value: 0 },
            ],
          },
        ],
      },
    ],
  });
}

interface CustomScoreDetails {
  snapshot_id: string;
  total_child_weight: number;
  children: Array<{
    algorithm_key: string;
    algorithm_version: string;
    weight: number;
  }>;
}

describe('custom_score (e2e)', () => {
  let dbBytes: Buffer;
  let storage: InMemoryStorage;

  beforeAll(async () => {
    dbBytes = await buildDeepfundingDbBytes(PORTAL_SEED);
  });

  beforeEach(() => {
    storage = createInMemoryStorage();
    seedInputs(storage, dbBytes);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FIXED_NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs real children and exposes each native CSV plus the details JSON, with no wrapper files', async () => {
    const result = await computeCustomScore(buildCustomSnapshot(), storage);

    expect(result).toEqual({
      outputs: {
        voting_engagement: `snapshots/${SNAPSHOT_ID}/voting_engagement.csv`,
        proposal_engagement: `snapshots/${SNAPSHOT_ID}/proposal_engagement.csv`,
        custom_score_details: `snapshots/${SNAPSHOT_ID}/custom_score_details.json`,
      },
    });

    // Each child wrote its own native CSV under the shared parent snapshot
    // prefix; no weighted or parent-DID wrapper files exist.
    expect(storage.has(`snapshots/${SNAPSHOT_ID}/voting_engagement.csv`)).toBe(true);
    expect(storage.has(`snapshots/${SNAPSHOT_ID}/proposal_engagement.csv`)).toBe(true);
    expect(storage.has(`snapshots/${SNAPSHOT_ID}/voting_engagement_weighted_score.csv`)).toBe(false);
    expect(storage.has(`snapshots/${SNAPSHOT_ID}/proposal_engagement_weighted_score.csv`)).toBe(false);
  });

  it('preserves each native cohort: no parent-DID zero-fill and no weighting', async () => {
    const { outputs } = await computeCustomScore(buildCustomSnapshot(), storage);

    // The voting child's native cohort is the shared DID input, with its own
    // zero for the vote-less did:plc:c — raw child scores, not weighted shares.
    const votingRows = parseCsv(storage.readText(outputs.voting_engagement as string) as string);
    expect(votingRows).toEqual([
      { did: 'did:plc:a', voting_engagement: '1' },
      { did: 'did:plc:b', voting_engagement: '0' },
      { did: 'did:plc:c', voting_engagement: '0' },
    ]);

    // The portal child's native cohort is the portal user set: did:plc:c has no
    // portal identity, so no row is rebuilt for it from the parent DID list.
    const proposalRows = parseCsv(storage.readText(outputs.proposal_engagement as string) as string);
    expect(proposalRows).toEqual([
      { did: 'did:plc:a', proposal_engagement: '1.8' },
      { did: 'did:plc:b', proposal_engagement: '-0.4' },
    ]);
  });

  it('writes configuration-only details without per-user scores', async () => {
    const { outputs } = await computeCustomScore(buildCustomSnapshot(), storage);
    const details = storage.readJson<CustomScoreDetails>(outputs.custom_score_details as string);

    expect(details).toEqual({
      snapshot_id: SNAPSHOT_ID,
      total_child_weight: 4,
      children: [
        { algorithm_key: 'voting_engagement', algorithm_version: '1.0.0', weight: 1 },
        { algorithm_key: 'proposal_engagement', algorithm_version: '1.0.0', weight: 3 },
      ],
    });
  });

  it("portal children share the run's single deepfunding.db under the parent snapshot id", async () => {
    const portalSnapshotId = 'snap-custom-portal-e2e';
    const portalStorage = createInMemoryStorage();
    portalStorage.seed(
      'uploads/portal-dids.json',
      JSON.stringify({
        'did:plc:a': { userWallets: [] },
        'did:plc:b': { userWallets: [] },
      }),
    );
    // One combined portal DB feeds both children in the same run: proposals and
    // reviews for proposal_engagement, comments for contribution_score.
    portalStorage.seed(
      `snapshots/${portalSnapshotId}/deepfunding.db`,
      await buildDeepfundingDbBytes({
        users: [userSeed({ id: 1, did: 'did:plc:a' }), userSeed({ id: 2, did: 'did:plc:b' })],
        proposals: [
          proposalSeed({
            id: 1,
            round_id: 31,
            proposer_id: 1,
            is_awarded: true,
            is_completed: true,
            created_at: RECENT,
          }),
          proposalSeed({
            id: 2,
            round_id: 36,
            proposer_id: 2,
            is_awarded: false,
            is_completed: false,
            created_at: RECENT,
          }),
          proposalSeed({ id: 300, proposer_id: 9 }), // unsupported round → ignored by proposal scoring
        ],
        reviews: [
          reviewSeed({ proposal_id: 1, review_type: 'community', overall_rating: '4' }),
          reviewSeed({ proposal_id: 1, review_type: 'community', overall_rating: '5' }),
          reviewSeed({ proposal_id: 2, review_type: 'community', overall_rating: '3' }),
        ],
        comments: [commentSeed({ comment_id: 1, user_id: 1, proposal_id: 300, created_at: '2025-12-01T00:00:00Z' })],
      }),
    );

    const { outputs } = await computeCustomScore(
      buildSnapshot({
        id: portalSnapshotId,
        key: 'custom_score',
        version: '1.0.0',
        inputs: [
          { key: 'dids', value: 'uploads/portal-dids.json' },
          {
            key: 'sub_algorithms',
            value: [
              {
                algorithm_key: 'proposal_engagement',
                algorithm_version: '1.0.0',
                weight: 1,
                inputs: [
                  { key: 'funded_concluded_reward_weight', value: 2 },
                  { key: 'unfunded_penalty_weight', value: 1 },
                  { key: 'engagement_window_months', value: 48 },
                  { key: 'monthly_decay_rate_percent', value: 0 },
                ],
              },
              {
                algorithm_key: 'contribution_score',
                algorithm_version: '1.0.0',
                weight: 1,
                inputs: [
                  { key: 'comment_base_score', value: 10 },
                  { key: 'comment_upvote_weight', value: 2 },
                  { key: 'comment_downvote_weight', value: 1 },
                  { key: 'self_interaction_penalty_factor', value: 0.5 },
                  { key: 'project_owner_upvote_bonus_multiplier', value: 3 },
                  { key: 'engagement_window_months', value: 24 },
                  { key: 'monthly_decay_rate_percent', value: 0 },
                ],
              },
            ],
          },
        ],
      }),
      portalStorage,
    );

    // Both children read the same DB and kept their native CSVs under the parent
    // prefix, each on its own raw scale.
    expect(parseCsv(portalStorage.readText(outputs.proposal_engagement as string) as string)).toEqual([
      { did: 'did:plc:a', proposal_engagement: '1.8' },
      { did: 'did:plc:b', proposal_engagement: '-0.4' },
    ]);
    expect(parseCsv(portalStorage.readText(outputs.contribution_score as string) as string)).toEqual([
      { did: 'did:plc:a', contribution_score: '10' },
      { did: 'did:plc:b', contribution_score: '0' },
    ]);
  });
});

describe('custom_score (e2e) — edge cases', () => {
  it('keeps an all-equal child vector unchanged', async () => {
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
    // Both collections vote uniformly → the voting child scores both DIDs at
    // 100. custom_score must NOT re-run min–max (which would collapse the equal
    // vector to 0) or rescale by weight; the native 100s flow through.
    storage.seed(
      'uploads/v.csv',
      toCsv(['collection_id', 'question_id', 'answer'], [...uniformVotes('colA'), ...uniformVotes('colB')]),
    );

    const { outputs } = await computeCustomScore(
      buildSnapshot({
        id: 'snap-custom-equal',
        key: 'custom_score',
        inputs: [
          { key: 'dids', value: 'uploads/dids.json' },
          {
            key: 'sub_algorithms',
            value: [
              {
                algorithm_key: 'voting_engagement',
                algorithm_version: '1.0.0',
                weight: 2,
                inputs: [
                  { key: 'votes', value: 'uploads/v.csv' },
                  { key: 'wallet_collections', value: 'uploads/wc.csv' },
                ],
              },
            ],
          },
        ],
      }),
      storage,
    );

    const rows = parseCsv(storage.readText(outputs.voting_engagement as string) as string);
    expect(rows).toEqual([
      { did: 'did:plc:a', voting_engagement: '1' },
      { did: 'did:plc:b', voting_engagement: '1' },
    ]);
  });

  it('rejects a preset that adds the same sub-algorithm twice', async () => {
    const storage = createInMemoryStorage();
    const snapshot = buildSnapshot({
      id: 'snap-custom-duplicate',
      key: 'custom_score',
      inputs: [
        { key: 'dids', value: 'uploads/dids.json' },
        {
          key: 'sub_algorithms',
          value: [
            { algorithm_key: 'voting_engagement', algorithm_version: '1.0.0', weight: 1, inputs: [] },
            { algorithm_key: 'voting_engagement', algorithm_version: '1.0.0', weight: 3, inputs: [] },
          ],
        },
      ],
    });

    await expect(computeCustomScore(snapshot, storage)).rejects.toThrow(
      'Duplicate sub-algorithm "voting_engagement": each sub-algorithm can be added only once',
    );
  });
});
