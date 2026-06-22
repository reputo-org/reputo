import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseCsv } from '../utils/csv.js';
import {
  buildDeepfundingDbBytes,
  commentSeed,
  commentVoteSeed,
  proposalSeed,
  userSeed,
} from '../utils/deepfunding-db.js';
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

const { computeContributionScore } = await import(
  '../../../src/activities/typescript/algorithms/contribution-score/compute.js'
);

const SNAPSHOT_ID = 'snap-contribution-e2e';
const DB_KEY = `snapshots/${SNAPSHOT_ID}/deepfunding.db`;
const FIXED_NOW = '2026-01-01T00:00:00.000Z';

/**
 * Scenario (all decay off → tw=1 within the 24-month window):
 *  - alice (user 1, did:plc:alice) authors two scored comments:
 *      c1 on a foreign proposal (no owner upvote, no self-interaction) → 12,
 *      c2 on her OWN proposal (self-interaction ×0.5) upvoted by a project
 *         owner (bonus ×3) → 18.  alice total = 30.
 *  - bob (user 2, did:plc:bob) authors c3, dated outside the window → not scored
 *      → score 0, unmatched.
 *  - carol (user 3, blank did) authors c4 → excluded from every output.
 * Params: base 10, upvote ×2, downvote ×1, self-interaction 0.5, owner bonus ×3.
 */
const SEED = {
  users: [
    userSeed({ id: 1, did: 'did:plc:alice' }),
    userSeed({ id: 2, did: 'did:plc:bob' }),
    userSeed({ id: 3, did: '' }), // blank DID → skipped everywhere
  ],
  proposals: [
    proposalSeed({ id: 100, proposer_id: 1, team_members: [2] }), // owners {1,2}
    proposalSeed({ id: 200, proposer_id: 9, team_members: [] }), // owners {9}
  ],
  comments: [
    commentSeed({ comment_id: 1, user_id: 1, proposal_id: 200, created_at: '2025-12-01T00:00:00Z' }),
    commentSeed({ comment_id: 2, user_id: 1, proposal_id: 100, created_at: '2025-12-15T00:00:00Z' }),
    commentSeed({ comment_id: 3, user_id: 2, proposal_id: 100, created_at: '2023-01-01T00:00:00Z' }), // out of window
    commentSeed({ comment_id: 4, user_id: 3, proposal_id: 100, created_at: '2025-12-20T00:00:00Z' }), // carol
  ],
  commentVotes: [
    commentVoteSeed({ voter_id: 5, comment_id: 1, vote_type: 'upvote' }), // non-owner
    commentVoteSeed({ voter_id: 2, comment_id: 2, vote_type: 'upvote' }), // owner (bob) → bonus
  ],
};

function buildContributionSnapshot() {
  return buildSnapshot({
    id: SNAPSHOT_ID,
    key: 'contribution_score',
    version: '1.0.0',
    inputs: [
      { key: 'comment_base_score', value: 10 },
      { key: 'comment_upvote_weight', value: 2 },
      { key: 'comment_downvote_weight', value: 1 },
      { key: 'self_interaction_penalty_factor', value: 0.5 },
      { key: 'project_owner_upvote_bonus_multiplier', value: 3 },
      { key: 'engagement_window_months', value: 24 },
      { key: 'monthly_decay_rate_percent', value: 0 },
    ],
  });
}

interface ContributionDetails {
  dids: Array<{
    did: string;
    contribution_score: number;
    comment_count: number;
    comments: Array<{
      comment_id: number;
      base_score: number;
      comment_score: number;
      scored: boolean;
      votes: { upvotes: number; downvotes: number; upvoter_ids: number[] };
      time_weight: { tw: number; is_within_window: boolean };
      self_interaction: {
        is_related_project: boolean;
        is_same_author_reply: boolean;
        discount_conditions: number;
        discount_multiplier: number;
      };
      owner_bonus: { owner_upvoted: boolean; owner_bonus: number };
    }>;
  }>;
  metadata: {
    snapshot_id: string;
    config: Record<string, number>;
    dids: { provided_ids: string[]; matched_ids: string[]; unmatched_ids: string[] };
    metrics: {
      total_dids_provided: number;
      dids_with_matching_comments: number;
      total_comments_processed: number;
      total_comments_scored: number;
    };
  };
}

describe('contribution_score (e2e)', () => {
  let dbBytes: Buffer;
  let storage: InMemoryStorage;

  beforeAll(async () => {
    dbBytes = await buildDeepfundingDbBytes(SEED);
  });

  beforeEach(() => {
    storage = createInMemoryStorage();
    storage.seed(DB_KEY, dbBytes);
    // Fake ONLY Date so time-weight is deterministic; real timers keep the async
    // CSV serialization working.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FIXED_NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('downloads the seeded portal DB and returns snapshot-scoped output keys', async () => {
    const result = await computeContributionScore(buildContributionSnapshot(), storage);

    expect(result).toEqual({
      outputs: {
        contribution_score: `snapshots/${SNAPSHOT_ID}/contribution_score.csv`,
        contribution_score_details: `snapshots/${SNAPSHOT_ID}/contribution_score_details.json`,
      },
    });
  });

  it('scores each DID-bearing user and excludes blank-DID users from the CSV', async () => {
    const { outputs } = await computeContributionScore(buildContributionSnapshot(), storage);

    const rows = parseCsv(storage.readText(outputs.contribution_score as string) as string);
    expect(rows).toEqual([
      { did: 'did:plc:alice', contribution_score: '30' }, // 12 + 18
      { did: 'did:plc:bob', contribution_score: '0' }, // only comment is out of window
    ]);
  });

  it('records owner-bonus, self-interaction, window and DID-matching detail in the JSON', async () => {
    const { outputs } = await computeContributionScore(buildContributionSnapshot(), storage);
    const details = storage.readJson<ContributionDetails>(outputs.contribution_score_details as string);

    expect(details.metadata.snapshot_id).toBe(SNAPSHOT_ID);
    expect(details.metadata.dids).toEqual({
      provided_ids: ['did:plc:alice', 'did:plc:bob'],
      matched_ids: ['did:plc:alice'],
      unmatched_ids: ['did:plc:bob'],
    });
    expect(details.metadata.metrics).toEqual({
      total_dids_provided: 2,
      dids_with_matching_comments: 1,
      total_comments_processed: 4, // c4 (blank DID) counts toward processed but is never scored
      total_comments_scored: 2,
    });

    const alice = details.dids.find((d) => d.did === 'did:plc:alice');
    expect(alice).toBeDefined();
    expect(alice?.contribution_score).toBe(30);
    expect(alice?.comment_count).toBe(2);

    const c1 = alice?.comments.find((c) => c.comment_id === 1);
    expect(c1).toMatchObject({
      base_score: 12,
      comment_score: 12,
      scored: true,
      votes: { upvotes: 1, downvotes: 0, upvoter_ids: [5] },
      time_weight: { tw: 1, is_within_window: true },
      self_interaction: { is_related_project: false, discount_conditions: 0, discount_multiplier: 1 },
      owner_bonus: { owner_upvoted: false, owner_bonus: 1 },
    });

    const c2 = alice?.comments.find((c) => c.comment_id === 2);
    expect(c2).toMatchObject({
      base_score: 12,
      comment_score: 18, // 3 (owner) × 1 (tw) × 0.5 (self-interaction) × 12
      scored: true,
      votes: { upvotes: 1, downvotes: 0, upvoter_ids: [2] },
      self_interaction: { is_related_project: true, discount_conditions: 1, discount_multiplier: 0.5 },
      owner_bonus: { owner_upvoted: true, owner_bonus: 3 },
    });

    const bob = details.dids.find((d) => d.did === 'did:plc:bob');
    expect(bob?.contribution_score).toBe(0);
    expect(bob?.comment_count).toBe(1);
    expect(bob?.comments[0]).toMatchObject({
      comment_id: 3,
      scored: false,
      comment_score: 0,
      time_weight: { tw: 0, is_within_window: false },
    });

    // carol (blank DID) appears in no DID record.
    expect(details.dids.some((d) => d.did === '')).toBe(false);
  });
});

describe('contribution_score (e2e) — edge cases', () => {
  const MS_PER_DAY = 86_400_000;
  const daysAgo = (n: number) => new Date(Date.parse(FIXED_NOW) - n * MS_PER_DAY).toISOString();

  let decayBytes: Buffer;
  let selfBytes: Buffer;

  beforeAll(async () => {
    // One comment 75 days old (≈2.46 months → decay bucket 2) with 1 upvote and 2 downvotes.
    decayBytes = await buildDeepfundingDbBytes({
      users: [userSeed({ id: 1, did: 'did:plc:alice' })],
      proposals: [proposalSeed({ id: 200, proposer_id: 9 })],
      comments: [commentSeed({ comment_id: 1, user_id: 1, proposal_id: 200, created_at: daysAgo(75) })],
      commentVotes: [
        commentVoteSeed({ voter_id: 7, comment_id: 1, vote_type: 'upvote' }),
        commentVoteSeed({ voter_id: 8, comment_id: 1, vote_type: 'downvote' }),
        commentVoteSeed({ voter_id: 9, comment_id: 1, vote_type: 'downvote' }),
      ],
    });

    // alice authors a root comment (50) and two replies to it: one on a foreign
    // proposal (reply penalty only) and one on her own proposal (related + reply).
    selfBytes = await buildDeepfundingDbBytes({
      users: [userSeed({ id: 1, did: 'did:plc:alice' })],
      proposals: [proposalSeed({ id: 100, proposer_id: 1 }), proposalSeed({ id: 200, proposer_id: 9 })],
      comments: [
        commentSeed({ comment_id: 50, user_id: 1, proposal_id: 200, created_at: daysAgo(5) }),
        commentSeed({
          comment_id: 2,
          user_id: 1,
          proposal_id: 200,
          is_reply: true,
          parent_id: 50,
          created_at: daysAgo(5),
        }),
        commentSeed({
          comment_id: 3,
          user_id: 1,
          proposal_id: 100,
          is_reply: true,
          parent_id: 50,
          created_at: daysAgo(5),
        }),
      ],
    });
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FIXED_NOW));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies monthly decay and downvote weighting', async () => {
    const id = 'snap-cs-decay';
    const storage = createInMemoryStorage();
    storage.seed(`snapshots/${id}/deepfunding.db`, decayBytes);

    const { outputs } = await computeContributionScore(
      buildSnapshot({
        id,
        key: 'contribution_score',
        inputs: [
          { key: 'comment_base_score', value: 10 },
          { key: 'comment_upvote_weight', value: 1 },
          { key: 'comment_downvote_weight', value: 2 },
          { key: 'self_interaction_penalty_factor', value: 1 },
          { key: 'project_owner_upvote_bonus_multiplier', value: 1 },
          { key: 'engagement_window_months', value: 24 },
          { key: 'monthly_decay_rate_percent', value: 10 },
        ],
      }),
      storage,
    );

    const rows = parseCsv(storage.readText(outputs.contribution_score as string) as string);
    expect(rows).toEqual([{ did: 'did:plc:alice', contribution_score: '5.6' }]); // (10 + 1 − 4) × tw 0.8

    const details = storage.readJson<ContributionDetails>(outputs.contribution_score_details as string);
    const c1 = details.dids[0].comments[0];
    expect(c1.base_score).toBe(7);
    expect(c1.time_weight.tw).toBe(0.8); // bucket 2, 10% per month
    expect(c1.votes).toEqual({ upvotes: 1, downvotes: 2, upvoter_ids: [7] });
    expect(c1.comment_score).toBe(5.6);
  });

  it('stacks self-interaction penalties for related-project and same-author replies', async () => {
    const id = 'snap-cs-self';
    const storage = createInMemoryStorage();
    storage.seed(`snapshots/${id}/deepfunding.db`, selfBytes);

    const { outputs } = await computeContributionScore(
      buildSnapshot({
        id,
        key: 'contribution_score',
        inputs: [
          { key: 'comment_base_score', value: 10 },
          { key: 'comment_upvote_weight', value: 1 },
          { key: 'comment_downvote_weight', value: 1 },
          { key: 'self_interaction_penalty_factor', value: 0.5 },
          { key: 'project_owner_upvote_bonus_multiplier', value: 1 },
          { key: 'engagement_window_months', value: 24 },
          { key: 'monthly_decay_rate_percent', value: 0 },
        ],
      }),
      storage,
    );

    const rows = parseCsv(storage.readText(outputs.contribution_score as string) as string);
    expect(rows).toEqual([{ did: 'did:plc:alice', contribution_score: '17.5' }]); // 10 + 5 + 2.5

    const details = storage.readJson<ContributionDetails>(outputs.contribution_score_details as string);
    const byId = (cid: number) => details.dids[0].comments.find((c) => c.comment_id === cid);

    expect(byId(50)?.self_interaction).toMatchObject({ discount_conditions: 0, discount_multiplier: 1 });
    expect(byId(50)?.comment_score).toBe(10);

    expect(byId(2)?.self_interaction).toMatchObject({
      is_related_project: false,
      is_same_author_reply: true,
      discount_conditions: 1,
      discount_multiplier: 0.5,
    });
    expect(byId(2)?.comment_score).toBe(5);

    expect(byId(3)?.self_interaction).toMatchObject({
      is_related_project: true,
      is_same_author_reply: true,
      discount_conditions: 2,
      discount_multiplier: 0.25,
    });
    expect(byId(3)?.comment_score).toBe(2.5);
  });
});
