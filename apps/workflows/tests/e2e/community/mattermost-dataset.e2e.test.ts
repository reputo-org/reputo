import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { communityActivityHarness, deepIdUsersHarness, sharedUndiciRequestMock } from '../utils/community-mocks.js';
import { createInMemoryStorage, TEST_BUCKET } from '../utils/in-memory-storage.js';

// Only the runtime boundary is mocked — undici (the synthetic server), the
// Temporal activity Context, and the env-backed config. The safe outbound
// policy, credential unsealing, the Mattermost adapter, the dataset engine,
// DuckDB staging, Parquet export, hashing, and the manifest commit all run for
// real against the in-memory Storage fake.
vi.mock('undici', async () => (await import('../utils/community-mocks.js')).sharedUndiciModuleMock());

const harness = communityActivityHarness();

const deepIdHarness = deepIdUsersHarness();

vi.mock('@reputo/deep-id-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@reputo/deep-id-api')>();
  return {
    ...actual,
    createDeepIdClient: () => ({
      async *iterateUsers() {
        yield { users: (await import('../utils/community-mocks.js')).deepIdUsersHarness().users };
      },
    }),
  };
});

vi.mock('@temporalio/activity', async () => {
  const { communityActivityHarness: shared, MockApplicationFailure } = await import('../utils/community-mocks.js');
  return {
    ApplicationFailure: MockApplicationFailure,
    Context: {
      current: () => ({
        log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
        heartbeat: (details: unknown) => {
          shared().heartbeats.push(details);
        },
        info: {
          get heartbeatDetails() {
            return shared().heartbeatDetails;
          },
        },
      }),
    },
  };
});

vi.mock('../../../src/config/index.js', async () => ({
  default: (await import('../utils/config-mock.js')).testConfig,
}));

const { sealCommunityCredential } = await import('@reputo/community-api');
const { createCommunityDependencyResolverActivities } = await import('../../../src/activities/community/index.js');
const { TEST_COMMUNITY_CREDENTIALS_SECRET } = await import('../utils/config-mock.js');
type CommunityManifest = import('../../../src/activities/community/index.js').CommunityDatasetManifest;

const mockRequest = sharedUndiciRequestMock();
const WINDOW = { windowStart: '2026-06-01T00:00:00.000Z', windowEnd: '2026-08-01T00:00:00.000Z' };

/** The server origin has to be allowlisted in the config mock's outbound policy. */
const SERVER_URL = 'http://127.0.0.1:8065';
const TEAM_ID = 'team-1';
const EXTERNAL_ID = `${SERVER_URL}/${TEAM_ID}`;
const BOT_TOKEN = 'mm-bot-token-never-logged';

const at = (iso: string): number => Date.parse(iso);

const post = (overrides: Record<string, unknown> & { id: string }) => ({
  user_id: 'u-alice',
  create_at: at('2026-07-01T10:00:00.000Z'),
  delete_at: 0,
  root_id: '',
  type: '',
  message: 'never read',
  ...overrides,
});

const USERS = [
  { id: 'u-alice', username: 'alice', is_bot: false },
  { id: 'u-bob', username: 'bob', is_bot: false },
  { id: 'u-hook', username: 'webhook', is_bot: true },
];

/**
 * The synthetic team: two readable channels and one the bot was never invited
 * into. `town-square` carries a thread, a reaction, a bot post, a system join,
 * and a post from before the window.
 */
const HISTORY: Record<string, Array<ReturnType<typeof post>>> = {
  'chan-town': [
    post({ id: 'sys1', type: 'system_join_channel', create_at: at('2026-07-05T10:00:00.000Z') }),
    post({ id: 'p4', user_id: 'u-hook', create_at: at('2026-07-04T10:00:00.000Z') }),
    post({ id: 'p3', user_id: 'u-bob', root_id: 'p1', create_at: at('2026-07-03T10:00:00.000Z') }),
    post({
      id: 'p1',
      create_at: at('2026-07-01T10:00:00.000Z'),
      metadata: { reactions: [{ user_id: 'u-bob' }, { user_id: 'u-bob' }] },
    }),
    post({ id: 'old', create_at: at('2026-01-01T10:00:00.000Z') }),
  ],
  'chan-dev': [post({ id: 'd1', user_id: 'u-bob', create_at: at('2026-07-02T10:00:00.000Z') })],
};

function serverRoutes(state: { denied: Set<string> }) {
  const calls: string[] = [];

  mockRequest.mockImplementation(async (rawUrl, options) => {
    const url = String(rawUrl);
    calls.push(url);
    const path = url.slice(SERVER_URL.length);
    // The safe outbound path caps the response, so it streams the body
    // instead of calling `text()`.
    const respond = (statusCode: number, body: unknown) => {
      const payload = Buffer.from(JSON.stringify(body));
      return {
        statusCode,
        headers: {},
        body: {
          text: () => Promise.resolve(payload.toString('utf8')),
          async *[Symbol.asyncIterator]() {
            yield payload;
          },
        },
      } as never;
    };

    if (path.startsWith('/api/v4/users/ids') || path.startsWith('/api/v4/users/usernames')) {
      const requested = JSON.parse(String((options as { body?: string }).body ?? '[]')) as string[];
      const byId = path.includes('/ids');
      return respond(
        200,
        USERS.filter((user) => requested.includes(byId ? user.id : user.username)),
      );
    }

    const [, , , , channelId] = path.split('/');
    if (state.denied.has(channelId)) {
      return respond(403, { id: 'api.context.permissions.app_error' });
    }

    const posts = HISTORY[channelId] ?? [];
    const query = new URLSearchParams(path.slice(path.indexOf('?') + 1));
    const before = query.get('before');
    const start = before === null ? 0 : posts.findIndex((entry) => entry.id === before) + 1;
    const page = posts.slice(start, start + Number(query.get('per_page') ?? 60));

    const carried = new Map(page.map((entry) => [entry.id, entry]));
    for (const entry of page) {
      const root = posts.find((other) => other.id === entry.root_id);
      if (root !== undefined) {
        carried.set(root.id, root);
      }
    }
    return respond(200, { order: page.map((entry) => entry.id), posts: Object.fromEntries(carried) });
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

const resolver = () => {
  const storage = createInMemoryStorage();
  const { resolveDependency } = createCommunityDependencyResolverActivities({
    storage: storage as never,
    storageConfig: { bucket: TEST_BUCKET, maxSizeBytes: 52_428_800 },
  });
  return { storage, resolveDependency };
};

const fetchInput = (overrides: Record<string, unknown> = {}) => ({
  dependencyKey: 'mattermost-activity' as const,
  snapshotId: 'snap-mm',
  communityFetch: {
    connectionId: 'conn-1',
    communityId: EXTERNAL_ID,
    resourceIds: ['chan-town', 'chan-dev', 'chan-private'],
    credentialsCiphertext: sealCommunityCredential(
      { currentSecret: TEST_COMMUNITY_CREDENTIALS_SECRET },
      { platform: 'mattermost', externalId: EXTERNAL_ID },
      BOT_TOKEN,
    ),
    ...WINDOW,
    ...overrides,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  harness.heartbeats = [];
  harness.heartbeatDetails = undefined;
  deepIdHarness.users = {
    'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa': { scopes: ['api', 'mattermost'], mattermost: socialIdentity('alice') },
    'did:sub:bbbbbbbbbbbbbbbbbbbbbbbb': { scopes: ['api', 'mattermost'], mattermost: socialIdentity('ghost') },
    'did:sub:cccccccccccccccccccccccc': { scopes: ['api'] },
  };
});

describe('mattermost dataset dependency (synthetic server)', () => {
  it('freezes the crawl into verified Parquet + manifest and never refetches a committed dataset', async () => {
    const { storage, resolveDependency } = resolver();
    const calls = serverRoutes({ denied: new Set(['chan-private']) });

    await resolveDependency(fetchInput());

    const prefix = 'snapshots/snap-mm/community_mattermost';
    const manifest = storage.readJson<CommunityManifest>(`${prefix}/manifest.json`);
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      platform: 'mattermost',
      snapshotId: 'snap-mm',
      window: { start: WINDOW.windowStart, end: WINDOW.windowEnd },
    });
    expect(manifest.fetchStats.requests).toBeGreaterThan(0);
    expect(harness.heartbeats.length).toBeGreaterThan(0);

    for (const [filename, meta] of Object.entries(manifest.files)) {
      const bytes = storage.readObject(`${prefix}/${filename}`) as Buffer;
      expect(sha256(bytes)).toBe(meta.sha256);
      expect(bytes.byteLength).toBe(meta.bytes);
    }

    const activities = await readParquet(
      storage.readObject(`${prefix}/activities.parquet`),
      'actor, counterparty, type, resource, object_id, CAST(occurred_at AS VARCHAR) AS occurred_at, count, bot',
    );
    // Rows are ordered by their own defining timestamps, the engine's key.
    expect(activities).toEqual([
      expect.objectContaining({ actor: 'u-alice', type: 'message', resource: 'chan-town', object_id: 'p1' }),
      // Both of bob's reactions collapse into one row that records him.
      expect.objectContaining({
        actor: 'u-alice',
        type: 'reaction_received',
        counterparty: 'u-bob',
        object_id: 'p1',
        count: '2',
      }),
      // The reply credits its root's author at the root's creation time.
      expect.objectContaining({
        actor: 'u-alice',
        type: 'reply_received',
        counterparty: 'u-bob',
        object_id: 'p3',
        occurred_at: '2026-07-01 10:00:00',
      }),
      expect.objectContaining({ actor: 'u-bob', type: 'message', resource: 'chan-dev', object_id: 'd1' }),
      expect.objectContaining({
        actor: 'u-bob',
        type: 'reply',
        counterparty: 'u-alice',
        object_id: 'p3',
        occurred_at: '2026-07-03 10:00:00',
      }),
      // A bot's post stays in the dataset, flagged. The system join and the
      // pre-window post produced no rows at all.
      expect.objectContaining({ actor: 'u-hook', type: 'message', object_id: 'p4', bot: true }),
    ]);

    // A channel the bot was never invited into is recorded, never silent.
    const coverage = await readParquet(storage.readObject(`${prefix}/coverage.parquet`), 'resource, status, reason');
    expect(coverage).toEqual([
      { resource: 'chan-dev', status: 'complete', reason: null },
      { resource: 'chan-private', status: 'failed', reason: 'permission_denied' },
      { resource: 'chan-town', status: 'complete', reason: null },
    ]);

    const cohort = await readParquet(
      storage.readObject(`${prefix}/cohort.parquet`),
      'did, username, account_id, status',
    );
    expect(cohort).toEqual([
      { did: 'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa', username: 'alice', account_id: 'u-alice', status: 'matched' },
      // Consented but not on this server: an explicit row, never a guess.
      { did: 'did:sub:bbbbbbbbbbbbbbbbbbbbbbbb', username: 'ghost', account_id: null, status: 'unmatched' },
    ]);
    // The whole cohort resolves in one bulk call.
    expect(calls.filter((url) => url.includes('/users/usernames'))).toHaveLength(1);

    // A retry of a committed dataset verifies the hashes and fetches nothing.
    const before = calls.length;
    await resolveDependency(fetchInput());
    expect(calls.length).toBe(before);
  });

  it('never lets the bot token reach a URL, the dataset, or the manifest', async () => {
    const { storage, resolveDependency } = resolver();
    const calls = serverRoutes({ denied: new Set(['chan-private']) });

    await resolveDependency(fetchInput());

    expect(calls.every((url) => !url.includes(BOT_TOKEN))).toBe(true);
    // `keys()` answers bucket-scoped ids; `readObject` re-applies the bucket.
    const stored = storage.keys().map((id) => id.slice(`${TEST_BUCKET}/`.length));
    expect(stored.length).toBeGreaterThan(0);
    for (const key of stored) {
      expect((storage.readObject(key) as Buffer).toString('binary')).not.toContain(BOT_TOKEN);
    }
  });

  it('refuses to fetch without the connection’s sealed credential', async () => {
    const { resolveDependency } = resolver();
    serverRoutes({ denied: new Set() });
    const input = fetchInput();
    const { credentialsCiphertext: _dropped, ...communityFetch } = input.communityFetch;

    await expect(resolveDependency({ ...input, communityFetch })).rejects.toThrow(/sealed credential/);
  });

  it('fails the fetch when no selected channel is readable', async () => {
    const { resolveDependency } = resolver();
    serverRoutes({ denied: new Set(['chan-town', 'chan-dev', 'chan-private']) });

    await expect(resolveDependency(fetchInput())).rejects.toThrow(/none of the 3 selected resources could be read/);
  });
});
