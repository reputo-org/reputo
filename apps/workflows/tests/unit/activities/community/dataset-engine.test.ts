import { readdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { DuckDBInstance } from '@duckdb/node-api';
import type {
  CommunityActivityRecord,
  CommunityAdapter,
  CommunityRecordBatch,
  CommunityResourceCoverage,
} from '@reputo/community-api';
import type { Storage } from '@reputo/storage';
import { describe, expect, it, vi } from 'vitest';
import {
  type CommunityDatasetManifest,
  type CommunityFetchCheckpoint,
  freezeCommunityDataset,
} from '../../../../src/activities/community/dataset-engine.js';
import { createInMemoryStorage, TEST_BUCKET } from '../../../e2e/utils/in-memory-storage.js';

const WINDOW = { start: '2026-06-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' };
const SNAPSHOT = 'snap-1';

const record = (overrides: Partial<CommunityActivityRecord> = {}): CommunityActivityRecord => ({
  type: 'message',
  actor: 'alice',
  counterparty: null,
  resource: 'r1',
  objectId: 'm1',
  occurredAt: '2026-07-01T00:00:00.000Z',
  count: 1,
  actorIsBot: false,
  deleted: false,
  ...overrides,
});

interface ResourceScript {
  batches: CommunityRecordBatch[];
  coverage: CommunityResourceCoverage;
}

/** Adapter stand-in yielding a fixed script per resource; records calls for resume assertions. */
function scriptedAdapter(script: Record<string, ResourceScript>) {
  const calls: Array<{ resourceId: string; cursor?: string }> = [];
  const adapter: CommunityAdapter = {
    platform: 'testplat',
    listResources: async () => [],
    probe: async () => ({ resourceCount: 0, sampledRecordCount: 0 }),
    // eslint-disable-next-line require-yield
    async *iterateRecords({ resourceId, cursor }) {
      calls.push({ resourceId, cursor });
      const entry = script[resourceId];
      if (!entry) {
        throw new Error(`no script for ${resourceId}`);
      }
      for (const batch of entry.batches) {
        yield batch;
      }
      return entry.coverage;
    },
  };
  return { adapter, calls };
}

function makeRun(args: {
  adapter: CommunityAdapter;
  resourceIds: string[];
  platform?: string;
  lastCheckpoint?: CommunityFetchCheckpoint;
}) {
  const storage = createInMemoryStorage();
  const heartbeats: CommunityFetchCheckpoint[] = [];
  const run = (checkpoint?: CommunityFetchCheckpoint) =>
    freezeCommunityDataset({
      snapshotId: SNAPSHOT,
      platform: args.platform ?? 'testplat',
      window: WINDOW,
      resourceIds: args.resourceIds,
      adapter: args.adapter,
      storage: storage as unknown as Storage,
      bucket: TEST_BUCKET,
      requestStats: { requests: 0, rateLimitWaits: 0, rateLimitWaitMs: 0 },
      progress: {
        heartbeat: (details) => heartbeats.push(details),
        lastCheckpoint: checkpoint ?? args.lastCheckpoint,
      },
      logger: { info: vi.fn(), warn: vi.fn() },
    });
  return { storage, heartbeats, run };
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

const scratchDirs = () => readdirSync(tmpdir()).filter((name) => name.startsWith('reputo-community-testplat'));

describe('freezeCommunityDataset', () => {
  it('crawls, stages, and commits the dataset with the manifest written last', async () => {
    const { adapter } = scriptedAdapter({
      r1: {
        batches: [
          {
            records: [
              record({ objectId: 'm2', occurredAt: '2026-07-02T00:00:00.000Z', actor: 'bob' }),
              record({ objectId: 'm1' }),
            ],
            cursor: 'c-1',
          },
          { records: [record({ objectId: 'm1', type: 'reaction_received', count: 4 })], cursor: 'c-2' },
        ],
        coverage: { resource: 'r1', status: 'complete' },
      },
      r2: {
        batches: [{ records: [record({ resource: 'r2', objectId: 'x1', actorIsBot: true })], cursor: 'c-3' }],
        coverage: { resource: 'r2', status: 'partial', reason: 'thread:permission_denied' },
      },
    });
    const { storage, heartbeats, run } = makeRun({ adapter, resourceIds: ['r1', 'r2'] });

    const result = await run();

    expect(result.committed).toBe(true);

    const prefix = `snapshots/${SNAPSHOT}/community_testplat`;
    const manifest = storage.readJson<CommunityDatasetManifest>(`${prefix}/manifest.json`);
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      platform: 'testplat',
      snapshotId: SNAPSHOT,
      window: WINDOW,
      duckdb: { version: expect.stringMatching(/^v\d+\.\d+\.\d+$/) },
    });
    expect(manifest.files['activities.parquet'].rows).toBe(4);
    expect(manifest.files['coverage.parquet'].rows).toBe(2);
    expect(manifest.fetchStats).toMatchObject({ pages: 3, rows: 4 });

    // The manifest is the commit: it is the last object written, and the
    // staging segments are gone afterwards.
    const puts = storage.putLog();
    expect(puts.at(-1)).toBe(`${prefix}/manifest.json`);
    expect(storage.keys().filter((key) => key.includes('/staging/'))).toEqual([]);

    const activities = await readParquet(
      storage.readObject(`${prefix}/activities.parquet`),
      'actor, counterparty, type, resource, object_id, CAST(occurred_at AS VARCHAR) AS occurred_at, count, bot, deleted',
    );
    expect(activities).toEqual([
      expect.objectContaining({ actor: 'alice', type: 'message', object_id: 'm1', count: '1', bot: false }),
      expect.objectContaining({ actor: 'alice', type: 'message', object_id: 'x1', resource: 'r2', bot: true }),
      expect.objectContaining({ actor: 'alice', type: 'reaction_received', object_id: 'm1', count: '4' }),
      expect.objectContaining({ actor: 'bob', type: 'message', object_id: 'm2' }),
    ]);

    const coverage = await readParquet(storage.readObject(`${prefix}/coverage.parquet`), 'resource, status, reason');
    expect(coverage).toEqual([
      { resource: 'r1', status: 'complete', reason: null },
      { resource: 'r2', status: 'partial', reason: 'thread:permission_denied' },
    ]);

    // One heartbeat per page batch at minimum, and the final checkpoint
    // carries every resource's coverage.
    expect(heartbeats.length).toBeGreaterThanOrEqual(3);
    const last = heartbeats.at(-1) as CommunityFetchCheckpoint;
    expect(last.resources.r1.coverage?.status).toBe('complete');
    expect(last.resources.r2.coverage?.status).toBe('partial');

    expect(scratchDirs()).toEqual([]);
  });

  it('drops out-of-window rows and deduplicates overlapping segments on the record identity', async () => {
    const duplicated = record({ objectId: 'm1', type: 'reaction_received', count: 3 });
    const { adapter } = scriptedAdapter({
      r1: {
        batches: [
          {
            records: [duplicated, record({ objectId: 'late', occurredAt: '2026-08-01T00:00:00.000Z' })],
            cursor: 'c-1',
          },
          { records: [{ ...duplicated, count: 5 }], cursor: 'c-2' },
        ],
        coverage: { resource: 'r1', status: 'complete' },
      },
    });
    const { storage, run } = makeRun({ adapter, resourceIds: ['r1'] });

    await run();

    const rows = await readParquet(
      storage.readObject(`snapshots/${SNAPSHOT}/community_testplat/activities.parquet`),
      'object_id, count',
    );
    expect(rows).toEqual([{ object_id: 'm1', count: '5' }]);
  });

  it('verifies and reuses an already-committed dataset without touching the platform', async () => {
    const script = {
      r1: {
        batches: [{ records: [record()], cursor: 'c-1' }],
        coverage: { resource: 'r1', status: 'complete' as const },
      },
    };
    const first = scriptedAdapter(script);
    const { storage, run } = makeRun({ adapter: first.adapter, resourceIds: ['r1'] });
    await run();
    const frozenBytes = storage.readObject(`snapshots/${SNAPSHOT}/community_testplat/activities.parquet`);

    const second = scriptedAdapter(script);
    const rerun = await freezeCommunityDataset({
      snapshotId: SNAPSHOT,
      platform: 'testplat',
      window: WINDOW,
      resourceIds: ['r1'],
      adapter: second.adapter,
      storage: storage as unknown as Storage,
      bucket: TEST_BUCKET,
      requestStats: { requests: 0, rateLimitWaits: 0, rateLimitWaitMs: 0 },
      progress: { heartbeat: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    expect(rerun.committed).toBe(false);
    expect(second.calls).toEqual([]);
    expect(storage.readObject(`snapshots/${SNAPSHOT}/community_testplat/activities.parquet`)).toEqual(frozenBytes);
  });

  it('sweeps staging segments an earlier attempt left behind after committing', async () => {
    const { adapter } = scriptedAdapter({
      r1: { batches: [{ records: [record()], cursor: 'c-1' }], coverage: { resource: 'r1', status: 'complete' } },
    });
    const { storage, run } = makeRun({ adapter, resourceIds: ['r1'] });
    await run();

    // Cleanup is best effort, so a committed dataset can still have leftovers.
    const leftover = `snapshots/${SNAPSHOT}/community_testplat/staging/r1.00000.ndjson.gz`;
    storage.seed(leftover, 'leftover');

    const rerun = await run();

    expect(rerun.committed).toBe(false);
    expect(storage.has(leftover)).toBe(false);
  });

  it('keeps a committed dataset when staging cleanup fails', async () => {
    const { adapter } = scriptedAdapter({
      r1: { batches: [{ records: [record()], cursor: 'c-1' }], coverage: { resource: 'r1', status: 'complete' } },
    });
    const storage = createInMemoryStorage();
    const warn = vi.fn();
    vi.spyOn(storage, 'deleteObjects').mockRejectedValue(new Error('s3 is unavailable'));

    const result = await freezeCommunityDataset({
      snapshotId: SNAPSHOT,
      platform: 'testplat',
      window: WINDOW,
      resourceIds: ['r1'],
      adapter,
      storage: storage as unknown as Storage,
      bucket: TEST_BUCKET,
      requestStats: { requests: 0, rateLimitWaits: 0, rateLimitWaitMs: 0 },
      progress: { heartbeat: vi.fn() },
      logger: { info: vi.fn(), warn },
    });

    expect(result.committed).toBe(true);
    expect(storage.has(`snapshots/${SNAPSHOT}/community_testplat/manifest.json`)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      'Community staging cleanup failed',
      expect.objectContaining({ platform: 'testplat' }),
    );
  });

  it('reports the surviving segments when only some deletions fail', async () => {
    const { adapter } = scriptedAdapter({
      r1: { batches: [{ records: [record()], cursor: 'c-1' }], coverage: { resource: 'r1', status: 'complete' } },
    });
    const storage = createInMemoryStorage();
    const warn = vi.fn();
    vi.spyOn(storage, 'deleteObjects').mockResolvedValue({
      deleted: [],
      errors: [{ key: 'staging/r1.00000.ndjson.gz', message: 'AccessDenied' }],
    });

    const result = await freezeCommunityDataset({
      snapshotId: SNAPSHOT,
      platform: 'testplat',
      window: WINDOW,
      resourceIds: ['r1'],
      adapter,
      storage: storage as unknown as Storage,
      bucket: TEST_BUCKET,
      requestStats: { requests: 0, rateLimitWaits: 0, rateLimitWaitMs: 0 },
      progress: { heartbeat: vi.fn() },
      logger: { info: vi.fn(), warn },
    });

    expect(result.committed).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      'Some community staging segments survived cleanup',
      expect.objectContaining({ deleted: 0, failed: 1 }),
    );
  });

  it('refuses a committed dataset whose content hash no longer matches', async () => {
    const { adapter } = scriptedAdapter({
      r1: { batches: [{ records: [record()], cursor: 'c-1' }], coverage: { resource: 'r1', status: 'complete' } },
    });
    const { storage, run } = makeRun({ adapter, resourceIds: ['r1'] });
    await run();

    storage.seed(`snapshots/${SNAPSHOT}/community_testplat/activities.parquet`, 'tampered');

    await expect(run()).rejects.toThrow(/hash verification/);
  });

  it('fails the snapshot with a clear error when every resource is unreadable', async () => {
    const { adapter } = scriptedAdapter({
      r1: { batches: [], coverage: { resource: 'r1', status: 'failed', reason: 'permission_denied' } },
      r2: { batches: [], coverage: { resource: 'r2', status: 'failed', reason: 'not_found' } },
    });
    const { storage, run } = makeRun({ adapter, resourceIds: ['r1', 'r2'] });

    await expect(run()).rejects.toThrow(
      /none of the 2 selected resources could be read \(permission_denied, not_found\)/,
    );
    expect(storage.has(`snapshots/${SNAPSHOT}/community_testplat/manifest.json`)).toBe(false);
    expect(scratchDirs()).toEqual([]);
  });

  it('resumes from the checkpoint: finished resources are skipped and staged segments are reused', async () => {
    const staged = [record({ objectId: 'staged-1', actor: 'earlier' }), record({ objectId: 'staged-2' })];
    const stagedLines = staged
      .map((entry) =>
        JSON.stringify({
          type: entry.type,
          actor: entry.actor,
          counterparty: entry.counterparty,
          resource: 'r1',
          object_id: entry.objectId,
          occurred_at: entry.occurredAt,
          count: entry.count,
          bot: entry.actorIsBot,
          deleted: entry.deleted,
        }),
      )
      .join('\n');

    const { adapter, calls } = scriptedAdapter({
      r2: {
        batches: [{ records: [record({ resource: 'r2', objectId: 'fresh-1' })], cursor: 'c-9' }],
        coverage: { resource: 'r2', status: 'complete' },
      },
    });
    const { storage, run } = makeRun({
      adapter,
      resourceIds: ['r1', 'r2'],
      lastCheckpoint: {
        resources: {
          r1: { segments: 1, coverage: { resource: 'r1', status: 'complete' } },
          r2: { segments: 0, cursor: 'resume-here' },
        },
        stats: { requests: 7, pages: 2, rows: 2, rateLimitWaits: 1, rateLimitWaitMs: 50, durationMs: 1000 },
      },
    });
    storage.seed(`snapshots/${SNAPSHOT}/community_testplat/staging/r1.00000.ndjson.gz`, gzipSync(stagedLines));

    await run();

    // Only the unfinished resource was crawled, from its cursor.
    expect(calls).toEqual([{ resourceId: 'r2', cursor: 'resume-here' }]);

    const rows = await readParquet(
      storage.readObject(`snapshots/${SNAPSHOT}/community_testplat/activities.parquet`),
      'object_id',
    );
    expect(rows.map((row) => row.object_id).sort()).toEqual(['fresh-1', 'staged-1', 'staged-2']);

    const manifest = storage.readJson<CommunityDatasetManifest>(
      `snapshots/${SNAPSHOT}/community_testplat/manifest.json`,
    );
    expect(manifest.fetchStats.requests).toBe(7);
    expect(manifest.fetchStats.pages).toBe(3);
    expect(manifest.fetchStats.rows).toBe(3);
  });

  it('freezes an empty window into a valid zero-row dataset', async () => {
    const { adapter } = scriptedAdapter({
      r1: { batches: [], coverage: { resource: 'r1', status: 'complete' } },
    });
    const { storage, run } = makeRun({ adapter, resourceIds: ['r1'] });

    const result = await run();

    expect(result.committed).toBe(true);
    expect(result.manifest.files['activities.parquet'].rows).toBe(0);
    const rows = await readParquet(
      storage.readObject(`snapshots/${SNAPSHOT}/community_testplat/activities.parquet`),
      'count(*) AS rows',
    );
    expect(rows).toEqual([{ rows: '0' }]);
  });

  it('rejects non-canonical window instants and empty resource selections', async () => {
    const { adapter } = scriptedAdapter({});
    const base = makeRun({ adapter, resourceIds: [] });
    await expect(base.run()).rejects.toThrow(/no selected resources/);

    await expect(
      freezeCommunityDataset({
        snapshotId: SNAPSHOT,
        platform: 'testplat',
        window: { start: '2026-06-01', end: WINDOW.end },
        resourceIds: ['r1'],
        adapter,
        storage: createInMemoryStorage() as unknown as Storage,
        bucket: TEST_BUCKET,
        requestStats: { requests: 0, rateLimitWaits: 0, rateLimitWaitMs: 0 },
        progress: { heartbeat: vi.fn() },
        logger: { info: vi.fn(), warn: vi.fn() },
      }),
    ).rejects.toThrow(/ISO 8601/);
  });
});
