import type { CommunityActivityRecord, CommunityAdapter } from '@reputo/community-api';
import type { Storage } from '@reputo/storage';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createInMemoryStorage, type InMemoryStorage, TEST_BUCKET } from '../utils/in-memory-storage.js';
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

const { freezeCommunityDataset } = await import('../../../src/activities/community/dataset-engine.js');
const { computeMattermostEngagement } = await import(
  '../../../src/activities/typescript/algorithms/mattermost-engagement/compute.js'
);
const { computeCustomScore } = await import('../../../src/activities/typescript/algorithms/custom-score/compute.js');

const SNAPSHOT_ID = 'snap-mattermost-e2e';
const WINDOW = { start: '2026-06-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' };

const DID_ALICE = 'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa';
const DID_BOB = 'did:sub:bbbbbbbbbbbbbbbbbbbbbbbb';
const DID_GHOST = 'did:sub:cccccccccccccccccccccccc';
const DID_DANA = 'did:sub:dddddddddddddddddddddddd';

const record = (overrides: Partial<CommunityActivityRecord>): CommunityActivityRecord => ({
  type: 'message',
  actor: 'u-alice',
  counterparty: null,
  resource: 'chan-town',
  objectId: 'p?',
  occurredAt: '2026-06-10T10:00:00.000Z',
  count: 1,
  actorIsBot: false,
  deleted: false,
  ...overrides,
});

/**
 * The synthetic frozen dataset, exercising every scoring rule:
 * - alice: 3 messages on 06-10 (over the daily cap of 2), 2 on 06-11 (exactly
 *   at the cap — the UTC midnight boundary splits 23:59:59.999Z from
 *   00:00:00.000Z), one reply on 06-12, and two reaction rows on one post
 *   (Mattermost records each reactor separately, so the cap of 3 applies to
 *   their sum). Three active days, credited days capped at 2.
 * - bob: one message and two reply_received rows (capped at 1) on 07-01; a
 *   bot-flagged row on 07-02 that must not score or mark a day active.
 * - 'u-stranger' is activity from a non-consented user: dataset context only.
 */
const ACTIVITY_RECORDS: CommunityActivityRecord[] = [
  record({ objectId: 'p1' }),
  record({ objectId: 'p2', occurredAt: '2026-06-10T12:00:00.000Z' }),
  record({ objectId: 'p3', occurredAt: '2026-06-10T23:59:59.999Z' }),
  record({ objectId: 'p4', occurredAt: '2026-06-11T00:00:00.000Z' }),
  record({ objectId: 'p5', occurredAt: '2026-06-11T05:00:00.000Z' }),
  record({ objectId: 'p1', type: 'reaction_received', counterparty: 'u-bob', count: 3 }),
  record({ objectId: 'p1', type: 'reaction_received', counterparty: 'u-stranger', count: 2 }),
  record({ objectId: 'r1', type: 'reply', counterparty: 'u-bob', occurredAt: '2026-06-12T08:00:00.000Z' }),
  record({ objectId: 'b1', actor: 'u-bob', occurredAt: '2026-07-01T09:00:00.000Z' }),
  record({ objectId: 'bb1', actor: 'u-bob', actorIsBot: true, occurredAt: '2026-07-02T09:00:00.000Z' }),
  record({
    objectId: 'b1',
    actor: 'u-bob',
    type: 'reply_received',
    counterparty: 'u-alice',
    occurredAt: '2026-07-01T09:00:00.000Z',
  }),
  record({
    objectId: 'b2',
    actor: 'u-bob',
    type: 'reply_received',
    counterparty: 'u-alice',
    occurredAt: '2026-07-01T10:00:00.000Z',
  }),
  record({ objectId: 's1', actor: 'u-stranger', occurredAt: '2026-07-03T09:00:00.000Z' }),
];

const COHORT = [
  { did: DID_ALICE, username: 'alice', accountId: 'u-alice', status: 'matched' as const },
  { did: DID_BOB, username: 'bob', accountId: 'u-bob', status: 'matched' as const },
  { did: DID_GHOST, username: 'ghost', accountId: null, status: 'unmatched' as const },
  { did: DID_DANA, username: 'dana', accountId: 'u-dana', status: 'matched' as const },
];

const ACTIVITY_WEIGHTS = [
  { activity: 'message', points: 1, daily_cap: 2 },
  { activity: 'reply', points: 1.5, daily_cap: 5 },
  { activity: 'reaction_received', points: 0.5, daily_cap: 3 },
  { activity: 'reply_received', points: 0.25, daily_cap: 1 },
  { activity: 'active_day', points: 2, daily_cap: 2 },
];

const PRESET_INPUTS = [
  { key: 'community_connection_id', value: '01990000-0000-7000-8000-000000000001' },
  { key: 'resources', value: ['chan-town', 'chan-dev'] },
  { key: 'lookback_days', value: 61 },
  { key: 'activities', value: ACTIVITY_WEIGHTS },
];

const EXPECTED_CSV = [
  'did,mattermost_engagement,message_points,reply_points,reaction_received_points,reply_received_points,active_day_points',
  `${DID_ALICE},11,4,1.5,1.5,0,4`,
  `${DID_BOB},3.25,1,0,0,0.25,2`,
  `${DID_GHOST},0,0,0,0,0,0`,
  `${DID_DANA},0,0,0,0,0,0`,
  '',
].join('\n');

function syntheticAdapter(): CommunityAdapter {
  return {
    platform: 'mattermost',
    listResources: async () => [],
    probe: async () => ({ resourceCount: 2, sampledRecordCount: 0 }),
    searchMemberId: async () => null,
    async *iterateRecords({ resourceId }) {
      if (resourceId === 'chan-town') {
        yield { records: ACTIVITY_RECORDS, cursor: 'end' };
        return { resource: 'chan-town', status: 'complete' as const };
      }
      // The bot was never invited into this one.
      return { resource: 'chan-dev', status: 'partial' as const, reason: 'posts:permission_denied' };
    },
  };
}

/** Freezes the synthetic dataset under the snapshot, exactly like the fetch dependency does. */
async function freezeDataset(storage: InMemoryStorage, snapshotId: string): Promise<void> {
  await freezeCommunityDataset({
    snapshotId,
    platform: 'mattermost',
    window: WINDOW,
    resourceIds: ['chan-town', 'chan-dev'],
    adapter: syntheticAdapter(),
    storage: storage as unknown as Storage,
    bucket: TEST_BUCKET,
    fetchCohort: async () => COHORT,
    requestStats: { requests: 0, rateLimitWaits: 0, rateLimitWaitMs: 0 },
    progress: { heartbeat: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn() },
  });
}

describe('mattermost_engagement compute (synthetic frozen dataset)', () => {
  let storage: InMemoryStorage;

  beforeAll(async () => {
    storage = createInMemoryStorage();
    await freezeDataset(storage, SNAPSHOT_ID);
  });

  it('scores the frozen dataset: SQL-capped integer units, weights in canonical order, explicit zeros', async () => {
    const snapshot = buildSnapshot({ id: SNAPSHOT_ID, key: 'mattermost_engagement', inputs: PRESET_INPUTS });

    const result = await computeMattermostEngagement(snapshot as never, storage as unknown as Storage);

    expect(result.outputs).toEqual({
      mattermost_engagement: `snapshots/${SNAPSHOT_ID}/mattermost_engagement.csv`,
      mattermost_engagement_details: `snapshots/${SNAPSHOT_ID}/mattermost_engagement_details.json`,
    });
    expect(storage.readText(`snapshots/${SNAPSHOT_ID}/mattermost_engagement.csv`)).toBe(EXPECTED_CSV);

    const details = storage.readJson<{
      users: Array<{
        did: string;
        status: string;
        score: number;
        activities: Record<string, { units: number; capped_units: number; points: number }>;
      }>;
      metadata: {
        platform: string;
        window: { start: string; end: string };
        cohort: Record<string, number>;
        coverage: Array<Record<string, unknown>>;
        activities: Array<Record<string, unknown>>;
      };
    }>(`snapshots/${SNAPSHOT_ID}/mattermost_engagement_details.json`);

    const alice = details.users.find((user) => user.did === DID_ALICE);
    expect(alice?.activities.message).toEqual({ units: 5, capped_units: 4, points: 4 });
    // Per-reactor rows are summed per day before the cap applies.
    expect(alice?.activities.reaction_received).toEqual({ units: 5, capped_units: 3, points: 1.5 });
    expect(alice?.activities.active_day).toEqual({ units: 3, capped_units: 2, points: 4 });

    const bob = details.users.find((user) => user.did === DID_BOB);
    expect(bob?.activities.reply_received).toEqual({ units: 2, capped_units: 1, points: 0.25 });

    const ghost = details.users.find((user) => user.did === DID_GHOST);
    expect(ghost).toMatchObject({ status: 'unmatched', score: 0 });

    expect(details.metadata.platform).toBe('mattermost');
    expect(details.metadata.window).toEqual(WINDOW);
    expect(details.metadata.cohort).toEqual({ consented: 4, matched: 3, unmatched: 1, active: 2, inactive: 2 });
    expect(details.metadata.coverage).toEqual([
      { resource: 'chan-dev', status: 'partial', reason: 'posts:permission_denied' },
      { resource: 'chan-town', status: 'complete' },
    ]);
    expect(details.metadata.activities).toEqual(
      ACTIVITY_WEIGHTS.map(({ activity, points, daily_cap }) => ({ activity, points, daily_cap })),
    );
  });

  it('replays the frozen dataset into byte-identical outputs', async () => {
    const snapshot = buildSnapshot({ id: SNAPSHOT_ID, key: 'mattermost_engagement', inputs: PRESET_INPUTS });

    await computeMattermostEngagement(snapshot as never, storage as unknown as Storage);
    const firstCsv = storage.readObject(`snapshots/${SNAPSHOT_ID}/mattermost_engagement.csv`);
    const firstDetails = storage.readObject(`snapshots/${SNAPSHOT_ID}/mattermost_engagement_details.json`);

    await computeMattermostEngagement(snapshot as never, storage as unknown as Storage);

    expect(storage.readObject(`snapshots/${SNAPSHOT_ID}/mattermost_engagement.csv`)).toEqual(firstCsv);
    expect(storage.readObject(`snapshots/${SNAPSHOT_ID}/mattermost_engagement_details.json`)).toEqual(firstDetails);
  });

  it('fails clearly when the dataset was never committed', async () => {
    const empty = createInMemoryStorage();
    const snapshot = buildSnapshot({ id: 'snap-mm-missing', key: 'mattermost_engagement', inputs: PRESET_INPUTS });

    await expect(computeMattermostEngagement(snapshot as never, empty as unknown as Storage)).rejects.toThrow(
      /not committed/,
    );
  });

  it('rejects an activity the platform does not emit', async () => {
    const snapshot = buildSnapshot({
      id: SNAPSHOT_ID,
      key: 'mattermost_engagement',
      inputs: [
        ...PRESET_INPUTS.filter((input) => input.key !== 'activities'),
        { key: 'activities', value: [{ activity: 'mention_received', points: 1, daily_cap: 5 }] },
      ],
    });

    await expect(computeMattermostEngagement(snapshot as never, storage as unknown as Storage)).rejects.toThrow(
      /Unknown activity "mention_received"/,
    );
  });

  it('runs as a custom_score child under the parent snapshot id, sharing the frozen dataset', async () => {
    const parent = buildSnapshot({
      id: SNAPSHOT_ID,
      key: 'custom_score',
      inputs: [
        {
          key: 'sub_algorithms',
          value: [
            {
              algorithm_key: 'mattermost_engagement',
              algorithm_version: '1.0.0',
              weight: 2,
              inputs: PRESET_INPUTS,
            },
          ],
        },
      ],
    });

    const result = await computeCustomScore(parent as never, storage as unknown as Storage);

    // The child's native raw CSV — the same bytes the standalone run produces —
    // is exposed under its own key for the raw submission path.
    expect(result.outputs.mattermost_engagement).toBe(`snapshots/${SNAPSHOT_ID}/mattermost_engagement.csv`);
    expect(storage.readText(`snapshots/${SNAPSHOT_ID}/mattermost_engagement.csv`)).toBe(EXPECTED_CSV);
    expect(result.outputs.custom_score_details).toBe(`snapshots/${SNAPSHOT_ID}/custom_score_details.json`);
  });

  it('rejects zero and negative child weights — weights must be positive app-wide', async () => {
    for (const weight of [0, -1]) {
      const parent = buildSnapshot({
        id: SNAPSHOT_ID,
        key: 'custom_score',
        inputs: [
          {
            key: 'sub_algorithms',
            value: [
              { algorithm_key: 'mattermost_engagement', algorithm_version: '1.0.0', weight, inputs: PRESET_INPUTS },
            ],
          },
        ],
      });

      await expect(computeCustomScore(parent as never, storage as unknown as Storage)).rejects.toThrow(
        /finite weight greater than 0|weight/,
      );
    }
  });
});
