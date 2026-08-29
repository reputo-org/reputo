import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { request } from 'undici';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createInMemoryStorage, TEST_BUCKET } from '../utils/in-memory-storage.js';

// Only the runtime boundary is mocked — undici (the synthetic guild), the
// Temporal activity Context, and the env-backed config. The Discord adapter,
// dataset engine, DuckDB staging, Parquet export, hashing, and the manifest
// commit all run for real against the in-memory Storage fake.
vi.mock('undici', () => ({ request: vi.fn() }));

const harness = vi.hoisted(() => ({
  heartbeats: [] as unknown[],
  heartbeatDetails: undefined as unknown,
}));

// DeepID is faked at the client factory: the cohort's consented-user pages come
// from this fixture, while the Discord member search still travels through the
// real adapter and the undici mock.
const deepIdHarness = vi.hoisted(() => ({
  users: {} as Record<string, unknown>,
}));

vi.mock('@reputo/deep-id-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@reputo/deep-id-api')>();
  return {
    ...actual,
    createDeepIdClient: () => ({
      async *iterateUsers() {
        yield { users: deepIdHarness.users };
      },
    }),
  };
});

vi.mock('@temporalio/activity', () => ({
  Context: {
    current: () => ({
      log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
      heartbeat: (details: unknown) => {
        harness.heartbeats.push(details);
      },
      info: {
        get heartbeatDetails() {
          return harness.heartbeatDetails;
        },
      },
    }),
  },
}));

vi.mock('../../../src/config/index.js', async () => ({
  default: (await import('../utils/config-mock.js')).testConfig,
}));

const { createCommunityDependencyResolverActivities } = await import('../../../src/activities/community/index.js');
type CommunityManifest = import('../../../src/activities/community/index.js').CommunityDatasetManifest;

const mockRequest = vi.mocked(request);
const WINDOW = { windowStart: '2026-06-01T00:00:00.000Z', windowEnd: '2026-08-01T00:00:00.000Z' };

const msg = (
  id: string,
  timestamp: string,
  author: { id: string; bot?: boolean },
  extra: Record<string, unknown> = {},
) => ({ id, type: 0, timestamp, author, ...extra });

/** The synthetic guild: two readable channels with threads, one denied channel. */
function installGuildRoutes(state: { failChannel2: boolean }) {
  const calls: string[] = [];
  const routes: Array<[string, (url: string) => { statusCode: number; body: unknown }]> = [
    [
      '/channels/c1/messages',
      () => ({
        statusCode: 200,
        body: [
          msg('9002', '2026-07-01T10:00:02.000Z', { id: 'hook', bot: true }),
          msg(
            '9001',
            '2026-07-01T10:00:01.000Z',
            { id: 'bob' },
            {
              type: 19,
              referenced_message: { id: '9000', timestamp: '2026-07-01T10:00:00.000Z', author: { id: 'alice' } },
              mentions: [{ id: 'alice' }],
            },
          ),
          msg('9000', '2026-07-01T10:00:00.000Z', { id: 'alice' }, { reactions: [{ count: 2 }, { count: 1 }] }),
          msg('100', '2026-01-01T00:00:00.000Z', { id: 'alice' }),
        ],
      }),
    ],
    [
      '/channels/c1/threads/archived/public',
      () => ({
        statusCode: 200,
        body: {
          threads: [
            { id: 't2', type: 11, parent_id: 'c1', thread_metadata: { archive_timestamp: '2026-07-15T00:00:00.000Z' } },
            { id: 't3', type: 11, parent_id: 'c1', thread_metadata: { archive_timestamp: '2020-01-01T00:00:00.000Z' } },
          ],
          has_more: false,
        },
      }),
    ],
    ['/channels/c1', () => ({ statusCode: 200, body: { id: 'c1', type: 0, guild_id: 'g1' } })],
    [
      '/channels/c2/messages',
      () => ({
        statusCode: 200,
        body: [msg('7000', '2026-07-20T00:00:00.000Z', { id: 'erin' })],
      }),
    ],
    ['/channels/c2/threads/archived/public', () => ({ statusCode: 200, body: { threads: [], has_more: false } })],
    ['/channels/c2', () => ({ statusCode: 200, body: { id: 'c2', type: 0, guild_id: 'g1' } })],
    ['/channels/c3', () => ({ statusCode: 403, body: { message: 'Missing Access' } })],
    [
      '/guilds/g1/members/search',
      (url: string) => {
        const query = new URL(url).searchParams.get('query');
        // Prefix matches around the exact hit prove the cohort narrows to an
        // exact username match, never a guess.
        return {
          statusCode: 200,
          body:
            query === 'alice'
              ? [{ user: { id: 'al2', username: 'alice2' } }, { user: { id: 'alice', username: 'alice' } }]
              : [],
        };
      },
    ],
    [
      '/guilds/g1/threads/active',
      () => ({
        statusCode: 200,
        body: { threads: [{ id: 't1', type: 11, parent_id: 'c1' }] },
      }),
    ],
    [
      '/channels/t1/messages',
      () => ({
        statusCode: 200,
        body: [msg('t1m', '2026-07-11T00:00:00.000Z', { id: 'carol' })],
      }),
    ],
    [
      '/channels/t2/messages',
      () => ({
        statusCode: 200,
        body: [msg('t2m', '2026-07-12T00:00:00.000Z', { id: 'dave' })],
      }),
    ],
  ];

  mockRequest.mockImplementation(async (rawUrl) => {
    const url = String(rawUrl);
    calls.push(url);
    if (state.failChannel2 && url.includes('/channels/c2')) {
      throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    }
    for (const [needle, respond] of routes) {
      if (url.includes(needle)) {
        const { statusCode, body } = respond(url);
        return {
          statusCode,
          headers: {},
          body: { text: () => Promise.resolve(JSON.stringify(body)) },
        } as never;
      }
    }
    throw new Error(`unrouted request: ${url}`);
  });
  return calls;
}

async function readParquet(bytes: Buffer | undefined, columns: string): Promise<Record<string, unknown>[]> {
  expect(bytes).toBeDefined();
  const dir = await mkdtemp(join(tmpdir(), 'parquet-read-'));
  try {
    const path = join(dir, 'x.parquet');
    await writeFile(path, bytes as Buffer);
    const instance = await DuckDBInstance.create(':memory:');
    const connection = await instance.connect();
    try {
      const result = await connection.runAndReadAll(`SELECT ${columns} FROM read_parquet('${path}')`);
      return result.getRowObjectsJson() as Record<string, unknown>[];
    } finally {
      connection.closeSync();
      instance.closeSync();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

const socialIdentity = (username: string) => ({
  username,
  verifiedAt: '2026-08-01T00:00:00.000Z',
  expiresAt: '2026-11-01T00:00:00.000Z',
  vc: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  harness.heartbeats = [];
  harness.heartbeatDetails = undefined;
  deepIdHarness.users = {
    'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa': { scopes: ['api', 'discord'], discord: socialIdentity('alice') },
    'did:sub:bbbbbbbbbbbbbbbbbbbbbbbb': { scopes: ['api', 'discord'], discord: socialIdentity('ghost') },
    'did:sub:cccccccccccccccccccccccc': { scopes: ['api', 'discord'], discord: null },
    'did:sub:dddddddddddddddddddddddd': { scopes: ['api'] },
  };
});

describe('discord dataset dependency (synthetic guild)', () => {
  it('freezes the crawl into verified Parquet + manifest, resumes a mid-crawl retry, and never refetches a committed dataset', async () => {
    const storage = createInMemoryStorage();
    const { resolveDependency } = createCommunityDependencyResolverActivities({
      storage: storage as never,
      storageConfig: { bucket: TEST_BUCKET, maxSizeBytes: 52_428_800 },
    });
    const input = {
      dependencyKey: 'discord-activity' as const,
      snapshotId: 'snap-e2e',
      communityFetch: { connectionId: 'conn-1', communityId: 'g1', resourceIds: ['c1', 'c2', 'c3'], ...WINDOW },
    };

    // Attempt 1: channel c2's network dies mid-crawl, after c1 finished. The
    // failure crosses the activity boundary as its safe category.
    const state = { failChannel2: true };
    installGuildRoutes(state);
    await expect(resolveDependency(input)).rejects.toThrow('Community discord fetch failed: network_error');
    expect(harness.heartbeats.length).toBeGreaterThan(0);
    expect(storage.has('snapshots/snap-e2e/community_discord/manifest.json')).toBe(false);

    // Attempt 2 resumes from the heartbeat checkpoint instead of restarting:
    // c1 is never touched again.
    harness.heartbeatDetails = harness.heartbeats.at(-1);
    state.failChannel2 = false;
    const retryCalls = installGuildRoutes(state);
    await resolveDependency(input);
    expect(retryCalls.filter((url) => url.includes('/channels/c1') || url.includes('/channels/t'))).toEqual([]);

    const prefix = 'snapshots/snap-e2e/community_discord';
    const manifest = storage.readJson<CommunityManifest>(`${prefix}/manifest.json`);
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      platform: 'discord',
      snapshotId: 'snap-e2e',
      window: { start: WINDOW.windowStart, end: WINDOW.windowEnd },
    });

    // The committed dataset's hashes verify against the stored bytes.
    for (const [filename, meta] of Object.entries(manifest.files)) {
      const bytes = storage.readObject(`${prefix}/${filename}`) as Buffer;
      expect(sha256(bytes)).toBe(meta.sha256);
      expect(bytes.byteLength).toBe(meta.bytes);
    }

    const activities = await readParquet(
      storage.readObject(`${prefix}/activities.parquet`),
      'actor, counterparty, type, resource, object_id, CAST(occurred_at AS VARCHAR) AS occurred_at, count, bot',
    );
    expect(activities).toEqual([
      expect.objectContaining({ actor: 'alice', type: 'message', object_id: '9000', count: '1', bot: false }),
      expect.objectContaining({ actor: 'alice', type: 'reaction_received', counterparty: null, count: '3' }),
      // The received row anchors to the receiving message's creation time.
      expect.objectContaining({
        actor: 'alice',
        type: 'reply_received',
        counterparty: 'bob',
        object_id: '9001',
        occurred_at: '2026-07-01 10:00:00',
      }),
      expect.objectContaining({ actor: 'alice', type: 'mention_received', counterparty: 'bob', object_id: '9001' }),
      expect.objectContaining({ actor: 'bob', type: 'reply', counterparty: 'alice', object_id: '9001' }),
      expect.objectContaining({ actor: 'hook', type: 'message', object_id: '9002', bot: true }),
      expect.objectContaining({ actor: 'carol', resource: 'c1', object_id: 't1m' }),
      expect.objectContaining({ actor: 'dave', resource: 'c1', object_id: 't2m' }),
      expect.objectContaining({ actor: 'erin', resource: 'c2', object_id: '7000' }),
    ]);
    expect(manifest.files['activities.parquet'].rows).toBe(9);

    // An unreadable channel is recorded, never silent.
    const coverage = await readParquet(storage.readObject(`${prefix}/coverage.parquet`), 'resource, status, reason');
    expect(coverage).toEqual([
      { resource: 'c1', status: 'complete', reason: null },
      { resource: 'c2', status: 'complete', reason: null },
      { resource: 'c3', status: 'failed', reason: 'permission_denied' },
    ]);

    // The frozen cohort keeps every consented user: matched by exact username,
    // unmatched (renamed or unlinked accounts) as explicit rows with a flag.
    const cohort = await readParquet(
      storage.readObject(`${prefix}/cohort.parquet`),
      'did, username, account_id, status',
    );
    expect(cohort).toEqual([
      { did: 'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa', username: 'alice', account_id: 'alice', status: 'matched' },
      { did: 'did:sub:bbbbbbbbbbbbbbbbbbbbbbbb', username: 'ghost', account_id: null, status: 'unmatched' },
      { did: 'did:sub:cccccccccccccccccccccccc', username: null, account_id: null, status: 'unmatched' },
    ]);
    expect(manifest.files['cohort.parquet'].rows).toBe(3);

    // Staging segments are gone after the commit; only the dataset remains.
    expect(storage.keys().filter((key) => key.includes('/staging/'))).toEqual([]);

    // A rerun of the same snapshot is first-writer-wins: the platform is never
    // called and the dataset bytes stay identical.
    const frozen = storage.readObject(`${prefix}/activities.parquet`);
    mockRequest.mockClear();
    mockRequest.mockRejectedValue(new Error('the platform must not be called for a committed dataset'));
    await resolveDependency(input);
    expect(mockRequest).not.toHaveBeenCalled();
    expect(storage.readObject(`${prefix}/activities.parquet`)).toEqual(frozen);
  });

  it('never lets a platform response body cross the activity boundary', async () => {
    const storage = createInMemoryStorage();
    const { resolveDependency } = createCommunityDependencyResolverActivities({
      storage: storage as never,
      storageConfig: { bucket: TEST_BUCKET, maxSizeBytes: 52_428_800 },
    });

    // A 500 body is echoed into CommunityHttpError's message; Temporal would
    // serialize it into workflow history and the orchestrator would persist it
    // on the snapshot, so the activity may only surface the safe category.
    const secretBody = { message: 'internal trace token=super-secret-value' };
    mockRequest.mockResolvedValue({
      statusCode: 500,
      headers: {},
      body: { text: () => Promise.resolve(JSON.stringify(secretBody)) },
    } as never);

    const failure = await resolveDependency({
      dependencyKey: 'discord-activity',
      snapshotId: 'snap-leak',
      communityFetch: { connectionId: 'conn-1', communityId: 'g1', resourceIds: ['c1'], ...WINDOW },
    }).catch((error: Error) => error);

    expect(failure).toBeInstanceOf(Error);
    const serialized = JSON.stringify({
      message: (failure as Error).message,
      stack: (failure as Error).stack,
      cause: (failure as Error).cause,
    });
    expect(serialized).not.toContain('super-secret-value');
    expect((failure as Error).message).toBe('Community discord fetch failed: upstream_error');
  });

  it('fails the snapshot with a clear error when no selected channel is readable', async () => {
    const storage = createInMemoryStorage();
    const { resolveDependency } = createCommunityDependencyResolverActivities({
      storage: storage as never,
      storageConfig: { bucket: TEST_BUCKET, maxSizeBytes: 52_428_800 },
    });
    installGuildRoutes({ failChannel2: false });

    await expect(
      resolveDependency({
        dependencyKey: 'discord-activity',
        snapshotId: 'snap-all-denied',
        communityFetch: { connectionId: 'conn-1', communityId: 'g1', resourceIds: ['c3'], ...WINDOW },
      }),
    ).rejects.toThrow(/none of the 1 selected resources could be read \(permission_denied\)/);
    expect(storage.has('snapshots/snap-all-denied/community_discord/manifest.json')).toBe(false);
  });

  it('rejects a non-community dependency key and a missing fetch input', async () => {
    const storage = createInMemoryStorage();
    const { resolveDependency } = createCommunityDependencyResolverActivities({
      storage: storage as never,
      storageConfig: { bucket: TEST_BUCKET, maxSizeBytes: 52_428_800 },
    });

    await expect(resolveDependency({ dependencyKey: 'onchain-data', snapshotId: 'snap-x' })).rejects.toThrow(
      /unexpected dependency/,
    );
    await expect(resolveDependency({ dependencyKey: 'discord-activity', snapshotId: 'snap-x' })).rejects.toThrow(
      /communityFetch/,
    );
    await expect(
      resolveDependency({
        dependencyKey: 'discord-activity',
        snapshotId: 'snap-x',
        communityFetch: { connectionId: 'conn-1', communityId: ' ', resourceIds: ['c1'], ...WINDOW },
      }),
    ).rejects.toThrow(/community id/);
  });
});
