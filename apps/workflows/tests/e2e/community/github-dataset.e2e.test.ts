import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { communityActivityHarness, deepIdUsersHarness, sharedUndiciRequestMock } from '../utils/community-mocks.js';
import { createInMemoryStorage, TEST_BUCKET } from '../utils/in-memory-storage.js';

// Only the runtime boundary is mocked — undici (the synthetic installation),
// the Temporal activity Context, and the env-backed config. The GitHub adapter,
// dataset engine, DuckDB staging, Parquet export, hashing, and the manifest
// commit all run for real against the in-memory Storage fake.
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
  const { communityActivityHarness: shared } = await import('../utils/community-mocks.js');
  return {
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

const { createCommunityDependencyResolverActivities } = await import('../../../src/activities/community/index.js');
type CommunityManifest = import('../../../src/activities/community/index.js').CommunityDatasetManifest;

const mockRequest = sharedUndiciRequestMock();
const WINDOW = { windowStart: '2026-06-01T00:00:00.000Z', windowEnd: '2026-08-01T00:00:00.000Z' };
const INSTALLATION_ID = '55';

const user = (id: number, login: string, type = 'User') => ({ id, login, type });

/** The synthetic installation: two readable repositories, one the App cannot read. */
function installRoutes(state: { failComments: boolean }) {
  const calls: string[] = [];
  const routes: Array<[string, (url: string) => { statusCode: number; body: unknown }]> = [
    [
      '/installation/repositories',
      () => ({
        statusCode: 200,
        body: {
          repositories: [
            { id: 1, name: 'snet', full_name: 'singnet/snet' },
            { id: 2, name: 'docs', full_name: 'singnet/docs' },
            { id: 3, name: 'private', full_name: 'singnet/private' },
          ],
        },
      }),
    ],
    [
      '/repos/singnet/snet/issues?',
      () => ({
        statusCode: 200,
        body: [
          { id: 10, number: 1, user: user(7, 'alice'), created_at: '2026-07-01T10:00:00Z' },
          // Opened long before the window, merged inside it: found because its
          // update moved, credited to the author by merge time.
          {
            id: 11,
            number: 2,
            user: user(8, 'bob'),
            created_at: '2025-01-01T00:00:00Z',
            pull_request: { merged_at: '2026-07-05T09:00:00Z' },
          },
          // A bot's pull request stays in the dataset, flagged.
          {
            id: 12,
            number: 3,
            user: user(9, 'dependabot[bot]', 'Bot'),
            created_at: '2026-07-06T09:00:00Z',
            pull_request: { merged_at: null },
          },
        ],
      }),
    ],
    [
      '/repos/singnet/snet/pulls/2/reviews',
      () => ({
        statusCode: 200,
        body: [
          { id: 21, user: user(7, 'alice'), state: 'APPROVED', submitted_at: '2026-07-04T09:00:00Z' },
          { id: 22, user: user(7, 'alice'), state: 'PENDING' },
        ],
      }),
    ],
    ['/repos/singnet/snet/pulls/3/reviews', () => ({ statusCode: 200, body: [] })],
    [
      '/repos/singnet/snet/issues/comments',
      () => ({
        statusCode: 200,
        body: [
          { id: 31, user: user(8, 'bob'), created_at: '2026-07-07T09:00:00Z' },
          // Edited inside the window but written before it — dropped on its own
          // defining timestamp.
          { id: 32, user: user(8, 'bob'), created_at: '2025-02-01T09:00:00Z' },
        ],
      }),
    ],
    [
      '/repos/singnet/snet/pulls/comments',
      () => ({ statusCode: 200, body: [{ id: 33, user: user(7, 'alice'), created_at: '2026-07-08T09:00:00Z' }] }),
    ],
    ['/repos/singnet/docs/issues?', () => ({ statusCode: 200, body: [] })],
    [
      '/repos/singnet/docs/issues/comments',
      () =>
        state.failComments
          ? { statusCode: 404, body: { message: 'Not Found' } }
          : { statusCode: 200, body: [{ id: 41, user: user(7, 'alice'), created_at: '2026-07-09T09:00:00Z' }] },
    ],
    ['/repos/singnet/docs/pulls/comments', () => ({ statusCode: 200, body: [] })],
    ['/repos/singnet/private/issues?', () => ({ statusCode: 403, body: { message: 'Resource not accessible' } })],
    ['/users/alice', () => ({ statusCode: 200, body: user(7, 'alice') })],
    ['/users/ghost', () => ({ statusCode: 404, body: { message: 'Not Found' } })],
  ];

  mockRequest.mockImplementation(async (rawUrl) => {
    const url = String(rawUrl);
    calls.push(url);
    if (url.includes('/access_tokens')) {
      return {
        statusCode: 201,
        headers: {},
        body: {
          text: () =>
            Promise.resolve(
              JSON.stringify({ token: 'ghs_installation_token', expires_at: '2099-01-01T00:00:00.000Z' }),
            ),
        },
      } as never;
    }
    for (const [needle, respond] of routes) {
      if (url.includes(needle)) {
        const { statusCode, body } = respond(url);
        return {
          statusCode,
          headers: {
            'x-ratelimit-limit': '12500',
            'x-ratelimit-remaining': '11000',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3_600),
          },
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

const resolver = () => {
  const storage = createInMemoryStorage();
  const { resolveDependency } = createCommunityDependencyResolverActivities({
    storage: storage as never,
    storageConfig: { bucket: TEST_BUCKET, maxSizeBytes: 52_428_800 },
  });
  return { storage, resolveDependency };
};

beforeEach(() => {
  vi.clearAllMocks();
  harness.heartbeats = [];
  harness.heartbeatDetails = undefined;
  deepIdHarness.users = {
    'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa': { scopes: ['api', 'github'], github: socialIdentity('alice') },
    'did:sub:bbbbbbbbbbbbbbbbbbbbbbbb': { scopes: ['api', 'github'], github: socialIdentity('ghost') },
    'did:sub:cccccccccccccccccccccccc': { scopes: ['api'] },
  };
});

describe('github dataset dependency (synthetic installation)', () => {
  it('freezes the crawl into verified Parquet + manifest and never refetches a committed dataset', async () => {
    const { storage, resolveDependency } = resolver();
    installRoutes({ failComments: false });

    const input = {
      dependencyKey: 'github-activity' as const,
      snapshotId: 'snap-gh',
      communityFetch: {
        connectionId: 'conn-1',
        communityId: INSTALLATION_ID,
        resourceIds: ['1', '2', '3'],
        ...WINDOW,
      },
    };
    await resolveDependency(input);

    const prefix = 'snapshots/snap-gh/community_github';
    const manifest = storage.readJson<CommunityManifest>(`${prefix}/manifest.json`);
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      platform: 'github',
      snapshotId: 'snap-gh',
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
      expect.objectContaining({ actor: '7', type: 'issue_opened', resource: '1', object_id: '10', count: '1' }),
      // A review credits the reviewer, with the pull request's author as counterparty.
      expect.objectContaining({
        actor: '7',
        type: 'pull_request_review',
        counterparty: '8',
        object_id: '21',
        occurred_at: '2026-07-04 09:00:00',
      }),
      // The old pull request is credited to its author at merge time only.
      expect.objectContaining({
        actor: '8',
        type: 'pull_request_merged',
        object_id: '11',
        occurred_at: '2026-07-05 09:00:00',
      }),
      expect.objectContaining({ actor: '9', type: 'pull_request_opened', object_id: '12', bot: true }),
      expect.objectContaining({ actor: '8', type: 'comment', object_id: '31' }),
      expect.objectContaining({ actor: '7', type: 'comment', object_id: '33' }),
      expect.objectContaining({ actor: '7', type: 'comment', resource: '2', object_id: '41' }),
    ]);

    // A repository the App cannot read is recorded, never silent.
    const coverage = await readParquet(storage.readObject(`${prefix}/coverage.parquet`), 'resource, status, reason');
    expect(coverage).toEqual([
      { resource: '1', status: 'complete', reason: null },
      { resource: '2', status: 'complete', reason: null },
      { resource: '3', status: 'failed', reason: 'permission_denied' },
    ]);

    // Consented logins are matched to their stable account ids; a login GitHub
    // does not know stays an explicit unmatched row.
    const cohort = await readParquet(
      storage.readObject(`${prefix}/cohort.parquet`),
      'did, username, account_id, status',
    );
    expect(cohort).toEqual([
      { did: 'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa', username: 'alice', account_id: '7', status: 'matched' },
      { did: 'did:sub:bbbbbbbbbbbbbbbbbbbbbbbb', username: 'ghost', account_id: null, status: 'unmatched' },
    ]);

    expect(storage.keys().filter((key) => key.includes('/staging/'))).toEqual([]);

    // A rerun of the same snapshot is first-writer-wins.
    const frozen = storage.readObject(`${prefix}/activities.parquet`);
    mockRequest.mockClear();
    mockRequest.mockRejectedValue(new Error('the platform must not be called for a committed dataset'));
    await resolveDependency(input);
    expect(mockRequest).not.toHaveBeenCalled();
    expect(storage.readObject(`${prefix}/activities.parquet`)).toEqual(frozen);
  });

  it('records a partially readable repository without failing the snapshot', async () => {
    const { storage, resolveDependency } = resolver();
    installRoutes({ failComments: true });

    await resolveDependency({
      dependencyKey: 'github-activity',
      snapshotId: 'snap-gh-partial',
      communityFetch: { connectionId: 'conn-1', communityId: INSTALLATION_ID, resourceIds: ['2'], ...WINDOW },
    });

    const coverage = await readParquet(
      storage.readObject('snapshots/snap-gh-partial/community_github/coverage.parquet'),
      'resource, status, reason',
    );
    expect(coverage).toEqual([{ resource: '2', status: 'partial', reason: 'issue_comments:not_found' }]);
  });

  it('fails the snapshot when no selected repository is readable', async () => {
    const { storage, resolveDependency } = resolver();
    installRoutes({ failComments: false });

    await expect(
      resolveDependency({
        dependencyKey: 'github-activity',
        snapshotId: 'snap-gh-denied',
        communityFetch: { connectionId: 'conn-1', communityId: INSTALLATION_ID, resourceIds: ['3'], ...WINDOW },
      }),
    ).rejects.toThrow(/none of the 1 selected resources could be read \(permission_denied\)/);
    expect(storage.has('snapshots/snap-gh-denied/community_github/manifest.json')).toBe(false);
  });

  it('never lets a platform response body cross the activity boundary', async () => {
    const { resolveDependency } = resolver();

    const secretBody = { message: 'internal trace token=super-secret-value' };
    mockRequest.mockResolvedValue({
      statusCode: 500,
      headers: {},
      body: { text: () => Promise.resolve(JSON.stringify(secretBody)) },
    } as never);

    const failure = await resolveDependency({
      dependencyKey: 'github-activity',
      snapshotId: 'snap-gh-leak',
      communityFetch: { connectionId: 'conn-1', communityId: INSTALLATION_ID, resourceIds: ['1'], ...WINDOW },
    }).catch((error: Error) => error);

    const serialized = JSON.stringify({
      message: (failure as Error).message,
      stack: (failure as Error).stack,
      cause: (failure as Error).cause,
    });
    expect(serialized).not.toContain('super-secret-value');
    expect((failure as Error).message).toBe('Community github fetch failed: upstream_error');
  });
});
