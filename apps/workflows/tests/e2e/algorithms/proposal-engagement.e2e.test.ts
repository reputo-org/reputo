import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseCsv } from '../utils/csv.js';
import { buildDeepfundingDbBytes, proposalSeed, reviewSeed, userSeed } from '../utils/deepfunding-db.js';
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

const { computeProposalEngagement } = await import(
  '../../../src/activities/typescript/algorithms/proposal-engagement/compute.js'
);

const SNAPSHOT_ID = 'snap-proposal-e2e';
const DB_KEY = `snapshots/${SNAPSHOT_ID}/deepfunding.db`;
const FIXED_NOW = '2026-01-01T00:00:00.000Z';
const RECENT = '2025-06-01T00:00:00Z'; // ~7 months old → inside a 48-month window, tw=1

/**
 * Scenario (reward weight ×2, penalty weight ×1, window 48mo, decay off):
 *  - p1 round 31, alice, awarded+completed, community ratings [4,5] (norm 0.9)
 *      → funded_concluded reward = 0.9 → alice engagement = 2 × 0.9 = 1.8.
 *  - p2 round 36, bob, not awarded, community rating [3] (norm 0.6)
 *      → unfunded penalty = 0.4 → bob engagement = -1 × 0.4 = -0.4.
 *  - p3 round 99 (unsupported)        → skip 'unsupported_round'.
 *  - p5 round 31, alice, no reviews   → skip 'no_community_reviews'.
 *  - p6 round 36, bob, awarded but not completed, has reviews
 *      → classification 'other' → skip 'not_reward_or_penalty_class'.
 *  - carol (blank DID) owns nothing scored and is absent from all output.
 */
const SEED = {
  users: [
    userSeed({ id: 1, did: 'did:plc:alice' }),
    userSeed({ id: 2, did: 'did:plc:bob' }),
    userSeed({ id: 3, did: '' }),
  ],
  proposals: [
    proposalSeed({ id: 1, round_id: 31, proposer_id: 1, is_awarded: true, is_completed: true, created_at: RECENT }),
    proposalSeed({ id: 2, round_id: 36, proposer_id: 2, is_awarded: false, is_completed: false, created_at: RECENT }),
    proposalSeed({ id: 3, round_id: 99, proposer_id: 1, is_awarded: true, is_completed: true, created_at: RECENT }),
    proposalSeed({ id: 5, round_id: 31, proposer_id: 1, is_awarded: true, is_completed: true, created_at: RECENT }),
    proposalSeed({ id: 6, round_id: 36, proposer_id: 2, is_awarded: true, is_completed: false, created_at: RECENT }),
  ],
  reviews: [
    reviewSeed({ proposal_id: 1, review_type: 'community', overall_rating: '4' }),
    reviewSeed({ proposal_id: 1, review_type: 'community', overall_rating: '5' }),
    reviewSeed({ proposal_id: 2, review_type: 'community', overall_rating: '3' }),
    reviewSeed({ proposal_id: 6, review_type: 'community', overall_rating: '4' }),
    // An expert review must be ignored by the community aggregation:
    reviewSeed({ proposal_id: 1, review_type: 'expert', overall_rating: '1' }),
  ],
};

function buildProposalSnapshot() {
  return buildSnapshot({
    id: SNAPSHOT_ID,
    key: 'proposal_engagement',
    version: '1.0.0',
    inputs: [
      { key: 'funded_concluded_reward_weight', value: 2 },
      { key: 'unfunded_penalty_weight', value: 1 },
      { key: 'engagement_window_months', value: 48 },
      { key: 'monthly_decay_rate_percent', value: 0 },
    ],
  });
}

interface ProposalDetails {
  dids: Array<{
    did: string;
    proposal_engagement: number;
    positive_sum: number;
    negative_sum: number;
    proposal_count: number;
    proposals: Array<{
      proposal_id: number;
      owners: { proposer_id: number; team_member_ids: number[]; all_owner_ids: number[] };
      classification: { classification: string };
      community_score: { count: number; avg: number | null; norm: number | null };
      time_weight: { tw: number; is_within_window: boolean };
      score: { proposal_reward: number; proposal_penalty: number; scored: boolean; skip_reason: string | null };
    }>;
  }>;
  metadata: {
    snapshot_id: string;
    dids: { provided_ids: string[]; matched_ids: string[]; unmatched_ids: string[] };
    metrics: {
      total_dids_provided: number;
      dids_with_matching_owner: number;
      total_proposals_processed: number;
      total_proposals_scored: number;
      proposals_skipped_unsupported_round: number;
    };
  };
}

describe('proposal_engagement (e2e)', () => {
  let dbBytes: Buffer;
  let storage: InMemoryStorage;

  beforeAll(async () => {
    dbBytes = await buildDeepfundingDbBytes(SEED);
  });

  beforeEach(() => {
    storage = createInMemoryStorage();
    storage.seed(DB_KEY, dbBytes);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FIXED_NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns snapshot-scoped output keys', async () => {
    const result = await computeProposalEngagement(buildProposalSnapshot(), storage);

    expect(result).toEqual({
      outputs: {
        proposal_engagement: `snapshots/${SNAPSHOT_ID}/proposal_engagement.csv`,
        proposal_engagement_details: `snapshots/${SNAPSHOT_ID}/proposal_engagement_details.json`,
      },
    });
  });

  it('rewards funded-concluded and penalizes unfunded proposals per weights', async () => {
    const { outputs } = await computeProposalEngagement(buildProposalSnapshot(), storage);

    const rows = parseCsv(storage.readText(outputs.proposal_engagement as string) as string);
    expect(rows).toEqual([
      { did: 'did:plc:alice', proposal_engagement: '1.8' }, // 2 × 0.9
      { did: 'did:plc:bob', proposal_engagement: '-0.4' }, // -1 × 0.4
    ]);
  });

  it('records classification, community norm, skip reasons and metrics in the JSON', async () => {
    const { outputs } = await computeProposalEngagement(buildProposalSnapshot(), storage);
    const details = storage.readJson<ProposalDetails>(outputs.proposal_engagement_details as string);

    expect(details.metadata.snapshot_id).toBe(SNAPSHOT_ID);
    expect(details.metadata.dids).toEqual({
      provided_ids: ['did:plc:alice', 'did:plc:bob'],
      matched_ids: ['did:plc:alice', 'did:plc:bob'],
      unmatched_ids: [],
    });
    expect(details.metadata.metrics).toEqual({
      total_dids_provided: 2,
      dids_with_matching_owner: 2,
      total_proposals_processed: 5,
      total_proposals_scored: 2,
      proposals_skipped_unsupported_round: 1,
    });

    const alice = details.dids.find((d) => d.did === 'did:plc:alice');
    expect(alice).toMatchObject({ proposal_engagement: 1.8, positive_sum: 0.9, negative_sum: 0, proposal_count: 3 });

    const p1 = alice?.proposals.find((p) => p.proposal_id === 1);
    expect(p1).toMatchObject({
      classification: { classification: 'funded_concluded' },
      community_score: { count: 2, avg: 4.5, norm: 0.9 }, // expert review ignored
      score: { proposal_reward: 0.9, proposal_penalty: 0, scored: true, skip_reason: null },
    });
    expect(alice?.proposals.find((p) => p.proposal_id === 3)?.score.skip_reason).toBe('unsupported_round');
    expect(alice?.proposals.find((p) => p.proposal_id === 5)?.score.skip_reason).toBe('no_community_reviews');

    const bob = details.dids.find((d) => d.did === 'did:plc:bob');
    expect(bob).toMatchObject({ proposal_engagement: -0.4, positive_sum: 0, negative_sum: 0.4, proposal_count: 2 });

    const p2 = bob?.proposals.find((p) => p.proposal_id === 2);
    expect(p2).toMatchObject({
      classification: { classification: 'unfunded' },
      community_score: { norm: 0.6 },
      score: { proposal_penalty: 0.4, scored: true, skip_reason: null },
    });
    expect(bob?.proposals.find((p) => p.proposal_id === 6)?.score.skip_reason).toBe('not_reward_or_penalty_class');

    // carol (blank DID) appears in no DID record.
    expect(details.dids.some((d) => d.did === '')).toBe(false);
  });
});

describe('proposal_engagement (e2e) — edge cases', () => {
  const MS_PER_DAY = 86_400_000;
  const daysAgo = (n: number) => new Date(Date.parse(FIXED_NOW) - n * MS_PER_DAY).toISOString();

  let teamBytes: Buffer;
  let decayBytes: Buffer;

  beforeAll(async () => {
    // A funded-concluded proposal owned by alice with bob as a team member.
    teamBytes = await buildDeepfundingDbBytes({
      users: [userSeed({ id: 1, did: 'did:plc:alice' }), userSeed({ id: 2, did: 'did:plc:bob' })],
      proposals: [
        proposalSeed({
          id: 1,
          round_id: 31,
          proposer_id: 1,
          team_members: [2],
          is_awarded: true,
          is_completed: true,
          created_at: RECENT,
        }),
      ],
      reviews: [reviewSeed({ proposal_id: 1, review_type: 'community', overall_rating: '5' })], // norm 1.0
    });

    // Same proposal but dated ~2.46 months old → decay bucket 2.
    decayBytes = await buildDeepfundingDbBytes({
      users: [userSeed({ id: 1, did: 'did:plc:alice' })],
      proposals: [
        proposalSeed({
          id: 1,
          round_id: 31,
          proposer_id: 1,
          is_awarded: true,
          is_completed: true,
          created_at: daysAgo(75),
        }),
      ],
      reviews: [reviewSeed({ proposal_id: 1, review_type: 'community', overall_rating: '5' })],
    });
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FIXED_NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('credits a scored proposal to both its proposer and team members', async () => {
    const id = 'snap-pe-team';
    const storage = createInMemoryStorage();
    storage.seed(`snapshots/${id}/deepfunding.db`, teamBytes);

    const { outputs } = await computeProposalEngagement(
      buildSnapshot({
        id,
        key: 'proposal_engagement',
        inputs: [
          { key: 'funded_concluded_reward_weight', value: 1 },
          { key: 'unfunded_penalty_weight', value: 1 },
          { key: 'engagement_window_months', value: 48 },
          { key: 'monthly_decay_rate_percent', value: 0 },
        ],
      }),
      storage,
    );

    const rows = parseCsv(storage.readText(outputs.proposal_engagement as string) as string);
    expect(rows).toEqual([
      { did: 'did:plc:alice', proposal_engagement: '1' }, // reward tw 1 × norm 1
      { did: 'did:plc:bob', proposal_engagement: '1' }, // team member shares the reward
    ]);

    const details = storage.readJson<ProposalDetails>(outputs.proposal_engagement_details as string);
    expect(details.metadata.dids.matched_ids).toEqual(['did:plc:alice', 'did:plc:bob']);
    for (const did of ['did:plc:alice', 'did:plc:bob']) {
      const row = details.dids.find((d) => d.did === did);
      expect(row?.proposal_count).toBe(1);
      expect(row?.positive_sum).toBe(1);
      expect(row?.proposals[0].owners.all_owner_ids).toEqual([1, 2]);
    }
  });

  it('applies monthly decay to the proposal reward', async () => {
    const id = 'snap-pe-decay';
    const storage = createInMemoryStorage();
    storage.seed(`snapshots/${id}/deepfunding.db`, decayBytes);

    const { outputs } = await computeProposalEngagement(
      buildSnapshot({
        id,
        key: 'proposal_engagement',
        inputs: [
          { key: 'funded_concluded_reward_weight', value: 1 },
          { key: 'unfunded_penalty_weight', value: 1 },
          { key: 'engagement_window_months', value: 48 },
          { key: 'monthly_decay_rate_percent', value: 10 },
        ],
      }),
      storage,
    );

    const rows = parseCsv(storage.readText(outputs.proposal_engagement as string) as string);
    expect(rows).toEqual([{ did: 'did:plc:alice', proposal_engagement: '0.8' }]); // tw 0.8 × norm 1

    const details = storage.readJson<ProposalDetails>(outputs.proposal_engagement_details as string);
    const p1 = details.dids[0].proposals.find((p) => p.proposal_id === 1);
    expect(p1?.time_weight).toMatchObject({ tw: 0.8, is_within_window: true });
    expect(p1?.community_score.norm).toBe(1);
    expect(p1?.score.proposal_reward).toBe(0.8);
  });
});
