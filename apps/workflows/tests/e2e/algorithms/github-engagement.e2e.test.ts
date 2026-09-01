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
const { computeGithubEngagement } = await import(
  '../../../src/activities/typescript/algorithms/github-engagement/compute.js'
);
const { computeCustomScore } = await import('../../../src/activities/typescript/algorithms/custom-score/compute.js');

const SNAPSHOT_ID = 'snap-github-e2e';
const WINDOW = { start: '2026-06-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' };

const DID_ALICE = 'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa';
const DID_BOB = 'did:sub:bbbbbbbbbbbbbbbbbbbbbbbb';
const DID_GHOST = 'did:sub:cccccccccccccccccccccccc';
const DID_DANA = 'did:sub:dddddddddddddddddddddddd';

const record = (overrides: Partial<CommunityActivityRecord>): CommunityActivityRecord => ({
  type: 'pull_request_opened',
  actor: '111',
  counterparty: null,
  resource: 'r1',
  objectId: 'o?',
  occurredAt: '2026-06-10T10:00:00.000Z',
  count: 1,
  actorIsBot: false,
  deleted: false,
  ...overrides,
});

/**
 * The synthetic frozen dataset, exercising every scoring rule:
 * - alice ('111'): 3 PRs opened on 06-10 (over the daily cap of 2) and one on
 *   06-11 — the UTC midnight boundary splits 23:59:59.999Z from 00:00:00.000Z;
 *   a PR opened before the window and merged inside it, credited to alice as
 *   its author at merge time (the merger never appears in the dataset); one
 *   review of bob's PR at its submission time; 4 comments across two days,
 *   capped at 2 per day.
 * - bob ('222'): 3 issues on 07-01 (capped at 2); a bot-flagged issue row on
 *   07-02 that must not score or count.
 * - '555' is activity from a non-consented stranger: dataset context only.
 */
const ACTIVITY_RECORDS: CommunityActivityRecord[] = [
  record({ objectId: 'pr1' }),
  record({ objectId: 'pr2', occurredAt: '2026-06-10T12:00:00.000Z' }),
  record({ objectId: 'pr3', occurredAt: '2026-06-10T23:59:59.999Z' }),
  record({ objectId: 'pr4', occurredAt: '2026-06-11T00:00:00.000Z' }),
  record({ objectId: 'pr0', type: 'pull_request_merged', occurredAt: '2026-06-15T09:00:00.000Z' }),
  record({
    objectId: 'rev1',
    type: 'pull_request_review',
    counterparty: '222',
    occurredAt: '2026-06-12T08:00:00.000Z',
  }),
  record({ objectId: 'c1', type: 'comment', occurredAt: '2026-06-20T10:00:00.000Z' }),
  record({ objectId: 'c2', type: 'comment', occurredAt: '2026-06-20T11:00:00.000Z' }),
  record({ objectId: 'c3', type: 'comment', occurredAt: '2026-06-20T12:00:00.000Z' }),
  record({ objectId: 'c4', type: 'comment', occurredAt: '2026-06-21T09:00:00.000Z' }),
  record({ objectId: 'i1', type: 'issue_opened', actor: '222', occurredAt: '2026-07-01T09:00:00.000Z' }),
  record({ objectId: 'i2', type: 'issue_opened', actor: '222', occurredAt: '2026-07-01T10:00:00.000Z' }),
  record({ objectId: 'i3', type: 'issue_opened', actor: '222', occurredAt: '2026-07-01T11:00:00.000Z' }),
  record({
    objectId: 'ib1',
    type: 'issue_opened',
    actor: '222',
    actorIsBot: true,
    occurredAt: '2026-07-02T09:00:00.000Z',
  }),
  record({ objectId: 's1', actor: '555', occurredAt: '2026-07-03T09:00:00.000Z' }),
];

const COHORT = [
  { did: DID_ALICE, username: 'alice', accountId: '111', status: 'matched' as const },
  { did: DID_BOB, username: 'bob', accountId: '222', status: 'matched' as const },
  { did: DID_GHOST, username: 'ghost', accountId: null, status: 'unmatched' as const },
  { did: DID_DANA, username: 'dana', accountId: '444', status: 'matched' as const },
];

// Deliberately reversed: the engine applies weights in the canonical activity
// order regardless of the preset's row order.
const ACTIVITY_WEIGHTS = [
  { activity: 'comment', points: 0.5, daily_cap: 2 },
  { activity: 'issue_opened', points: 3, daily_cap: 2 },
  { activity: 'pull_request_review', points: 5, daily_cap: 3 },
  { activity: 'pull_request_merged', points: 15, daily_cap: 5 },
  { activity: 'pull_request_opened', points: 10, daily_cap: 2 },
];

const PRESET_INPUTS = [
  { key: 'community_connection_id', value: '01990000-0000-7000-8000-000000000002' },
  { key: 'resources', value: ['r1', 'r2'] },
  { key: 'lookback_days', value: 61 },
  { key: 'activities', value: ACTIVITY_WEIGHTS },
];

const EXPECTED_CSV = [
  'did,github_engagement,pull_request_opened_points,pull_request_merged_points,pull_request_review_points,issue_opened_points,comment_points',
  `${DID_ALICE},51.5,30,15,5,0,1.5`,
  `${DID_BOB},6,0,0,0,6,0`,
  `${DID_GHOST},0,0,0,0,0,0`,
  `${DID_DANA},0,0,0,0,0,0`,
  '',
].join('\n');

function syntheticAdapter(): CommunityAdapter {
  return {
    platform: 'github',
    listResources: async () => [],
    probe: async () => ({ resourceCount: 2, sampledRecordCount: 0 }),
    searchMemberId: async () => null,
    async *iterateRecords({ resourceId }) {
      if (resourceId === 'r1') {
        yield { records: ACTIVITY_RECORDS, cursor: 'end' };
        return { resource: 'r1', status: 'complete' as const };
      }
      return { resource: 'r2', status: 'partial' as const, reason: 'repository:permission_denied' };
    },
  };
}

/** Freezes the synthetic dataset under the snapshot, exactly like the fetch dependency does. */
async function freezeDataset(storage: InMemoryStorage, snapshotId: string): Promise<void> {
  await freezeCommunityDataset({
    snapshotId,
    platform: 'github',
    window: WINDOW,
    resourceIds: ['r1', 'r2'],
    adapter: syntheticAdapter(),
    storage: storage as unknown as Storage,
    bucket: TEST_BUCKET,
    fetchCohort: async () => COHORT,
    requestStats: { requests: 0, rateLimitWaits: 0, rateLimitWaitMs: 0 },
    progress: { heartbeat: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn() },
  });
}

describe('github_engagement compute (synthetic frozen dataset)', () => {
  let storage: InMemoryStorage;

  beforeAll(async () => {
    storage = createInMemoryStorage();
    await freezeDataset(storage, SNAPSHOT_ID);
  });

  it('scores the frozen dataset: SQL-capped integer units, weights in canonical order, explicit zeros', async () => {
    const snapshot = buildSnapshot({ id: SNAPSHOT_ID, key: 'github_engagement', inputs: PRESET_INPUTS });

    const result = await computeGithubEngagement(snapshot as never, storage as unknown as Storage);

    expect(result.outputs).toEqual({
      github_engagement: `snapshots/${SNAPSHOT_ID}/github_engagement.csv`,
      github_engagement_details: `snapshots/${SNAPSHOT_ID}/github_engagement_details.json`,
    });
    expect(storage.readText(`snapshots/${SNAPSHOT_ID}/github_engagement.csv`)).toBe(EXPECTED_CSV);

    const details = storage.readJson<{
      users: Array<{
        did: string;
        status: string;
        score: number;
        activities: Record<string, { units: number; capped_units: number; points: number }>;
      }>;
      metadata: {
        window: { start: string; end: string };
        cohort: Record<string, number>;
        coverage: Array<Record<string, unknown>>;
        activities: Array<Record<string, unknown>>;
      };
    }>(`snapshots/${SNAPSHOT_ID}/github_engagement_details.json`);

    const alice = details.users.find((user) => user.did === DID_ALICE);
    expect(alice?.activities.pull_request_opened).toEqual({ units: 4, capped_units: 3, points: 30 });
    expect(alice?.activities.pull_request_merged).toEqual({ units: 1, capped_units: 1, points: 15 });
    expect(alice?.activities.pull_request_review).toEqual({ units: 1, capped_units: 1, points: 5 });
    expect(alice?.activities.comment).toEqual({ units: 4, capped_units: 3, points: 1.5 });

    const bob = details.users.find((user) => user.did === DID_BOB);
    expect(bob?.activities.issue_opened).toEqual({ units: 3, capped_units: 2, points: 6 });

    const ghost = details.users.find((user) => user.did === DID_GHOST);
    expect(ghost).toMatchObject({ status: 'unmatched', score: 0 });

    expect(details.metadata.window).toEqual(WINDOW);
    expect(details.metadata.cohort).toEqual({ consented: 4, matched: 3, unmatched: 1, active: 2, inactive: 2 });
    expect(details.metadata.coverage).toEqual([
      { resource: 'r1', status: 'complete' },
      { resource: 'r2', status: 'partial', reason: 'repository:permission_denied' },
    ]);
    expect(details.metadata.activities).toEqual([
      { activity: 'pull_request_opened', points: 10, daily_cap: 2 },
      { activity: 'pull_request_merged', points: 15, daily_cap: 5 },
      { activity: 'pull_request_review', points: 5, daily_cap: 3 },
      { activity: 'issue_opened', points: 3, daily_cap: 2 },
      { activity: 'comment', points: 0.5, daily_cap: 2 },
    ]);
  });

  it('replays the frozen dataset into byte-identical outputs', async () => {
    const snapshot = buildSnapshot({ id: SNAPSHOT_ID, key: 'github_engagement', inputs: PRESET_INPUTS });

    await computeGithubEngagement(snapshot as never, storage as unknown as Storage);
    const firstCsv = storage.readObject(`snapshots/${SNAPSHOT_ID}/github_engagement.csv`);
    const firstDetails = storage.readObject(`snapshots/${SNAPSHOT_ID}/github_engagement_details.json`);

    await computeGithubEngagement(snapshot as never, storage as unknown as Storage);

    expect(storage.readObject(`snapshots/${SNAPSHOT_ID}/github_engagement.csv`)).toEqual(firstCsv);
    expect(storage.readObject(`snapshots/${SNAPSHOT_ID}/github_engagement_details.json`)).toEqual(firstDetails);
  });

  it('fails clearly when the dataset was never committed', async () => {
    const empty = createInMemoryStorage();
    const snapshot = buildSnapshot({ id: 'snap-missing', key: 'github_engagement', inputs: PRESET_INPUTS });

    await expect(computeGithubEngagement(snapshot as never, empty as unknown as Storage)).rejects.toThrow(
      /not committed/,
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
              algorithm_key: 'github_engagement',
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
    expect(result.outputs.github_engagement).toBe(`snapshots/${SNAPSHOT_ID}/github_engagement.csv`);
    expect(storage.readText(`snapshots/${SNAPSHOT_ID}/github_engagement.csv`)).toBe(EXPECTED_CSV);
    expect(result.outputs.custom_score_details).toBe(`snapshots/${SNAPSHOT_ID}/custom_score_details.json`);
  });
});
