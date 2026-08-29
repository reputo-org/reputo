import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { DuckDBInstance } from '@duckdb/node-api';
import type {
  CommunityActivityRecord,
  CommunityAdapter,
  CommunityFetchWindow,
  CommunityResourceCoverage,
} from '@reputo/community-api';
import { ObjectNotFoundError, type Storage } from '@reputo/storage';
import {
  COMMUNITY_ACTIVITIES_FILENAME,
  COMMUNITY_COVERAGE_FILENAME,
  COMMUNITY_MANIFEST_FILENAME,
  getCommunityDatasetKey,
  getCommunityStagingPrefix,
} from '../../shared/constants/index.js';

const gzipAsync = promisify(gzip);

export const COMMUNITY_DATASET_SCHEMA_VERSION = 1;

/** Rows buffered locally before a resumable staging segment is committed to S3. */
const SEGMENT_MAX_ROWS = 5_000;

/** Doc-mandated DuckDB runtime settings; scratch holds any spill. */
const DUCKDB_MEMORY_LIMIT = '1GB';
const DUCKDB_THREADS = '2';

const ACTIVITY_COLUMN_TYPES =
  "{type: 'VARCHAR', actor: 'VARCHAR', counterparty: 'VARCHAR', resource: 'VARCHAR', " +
  "object_id: 'VARCHAR', occurred_at: 'TIMESTAMP', count: 'BIGINT', bot: 'BOOLEAN', deleted: 'BOOLEAN'}";

/** Fetch counters carried in the checkpoint so they survive activity retries. */
export interface CommunityFetchStats {
  requests: number;
  pages: number;
  rows: number;
  rateLimitWaits: number;
  rateLimitWaitMs: number;
  durationMs: number;
}

/** Transport-level counters the caller wires into the platform adapter's observer. */
export type CommunityRequestStats = Pick<CommunityFetchStats, 'requests' | 'rateLimitWaits' | 'rateLimitWaitMs'>;

interface ResourceProgress {
  /** Staging segments durably uploaded for this resource. */
  segments: number;
  /**
   * Adapter resume cursor covering everything uploaded so far. It only
   * advances together with a segment upload (or while nothing is buffered),
   * so a retry never skips rows that were still in memory.
   */
  cursor?: string;
  /** Set once the resource finished; a retried attempt skips it entirely. */
  coverage?: CommunityResourceCoverage;
}

/**
 * The crawl's durable progress, carried as Temporal heartbeat details. A
 * retry resumes from it instead of restarting: finished resources are
 * skipped, the in-progress resource continues from its cursor, and the
 * staged rows behind that cursor already live in S3.
 */
export interface CommunityFetchCheckpoint {
  resources: Record<string, ResourceProgress>;
  stats: CommunityFetchStats;
}

export interface CommunityDatasetManifest {
  schemaVersion: number;
  platform: string;
  snapshotId: string;
  window: CommunityFetchWindow;
  /** Per exported file: content hash, size, and row count. Later pipeline steps append here (cohort). */
  files: Record<string, { sha256: string; bytes: number; rows: number }>;
  fetchStats: CommunityFetchStats;
  duckdb: { version: string };
}

export interface CommunityEngineLogger {
  info(message: string, attrs?: Record<string, unknown>): void;
  warn(message: string, attrs?: Record<string, unknown>): void;
}

export interface FreezeCommunityDatasetInput {
  snapshotId: string;
  platform: string;
  window: CommunityFetchWindow;
  resourceIds: string[];
  adapter: CommunityAdapter;
  storage: Storage;
  bucket: string;
  /** Live transport counters for the current attempt (adapter observer output). */
  requestStats: CommunityRequestStats;
  progress: {
    heartbeat(checkpoint: CommunityFetchCheckpoint): void;
    lastCheckpoint?: CommunityFetchCheckpoint;
  };
  logger: CommunityEngineLogger;
}

export interface FreezeCommunityDatasetResult {
  /** False when a committed dataset already existed and its hashes verified. */
  committed: boolean;
  manifest: CommunityDatasetManifest;
}

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

const emptyStats = (): CommunityFetchStats => ({
  requests: 0,
  pages: 0,
  rows: 0,
  rateLimitWaits: 0,
  rateLimitWaitMs: 0,
  durationMs: 0,
});

function normalizeCheckpoint(checkpoint: CommunityFetchCheckpoint | undefined): CommunityFetchCheckpoint {
  if (!checkpoint || typeof checkpoint !== 'object' || typeof checkpoint.resources !== 'object') {
    return { resources: {}, stats: emptyStats() };
  }
  return { resources: checkpoint.resources ?? {}, stats: { ...emptyStats(), ...checkpoint.stats } };
}

/** Segment object key; index-addressed so an interrupted upload is overwritten, never duplicated. */
function segmentKey(snapshotId: string, platform: string, resourceId: string, index: number): string {
  return `${getCommunityStagingPrefix(snapshotId, platform)}${resourceId}.${String(index).padStart(5, '0')}.ndjson.gz`;
}

function toNdjsonLine(record: CommunityActivityRecord): string {
  return JSON.stringify({
    type: record.type,
    actor: record.actor,
    counterparty: record.counterparty,
    resource: record.resource,
    object_id: record.objectId,
    occurred_at: record.occurredAt,
    count: record.count,
    bot: record.actorIsBot,
    deleted: record.deleted,
  });
}

function assertIsoInstant(value: string, label: string): void {
  const ms = Date.parse(value);
  if (Number.isNaN(ms) || new Date(ms).toISOString() !== value) {
    throw new Error(`Community fetch ${label} must be a canonical ISO 8601 UTC instant, got "${value}"`);
  }
}

/**
 * Loads and verifies an already-committed dataset. Returns undefined when no
 * manifest exists; throws when a manifest exists but a file is missing or its
 * content hash does not match — a committed dataset must never change.
 */
async function readCommittedManifest(
  storage: Storage,
  bucket: string,
  snapshotId: string,
  platform: string,
): Promise<CommunityDatasetManifest | undefined> {
  let manifestRaw: Buffer;
  try {
    manifestRaw = await storage.getObject({
      bucket,
      key: getCommunityDatasetKey(snapshotId, platform, COMMUNITY_MANIFEST_FILENAME),
    });
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      return undefined;
    }
    throw error;
  }

  const manifest = JSON.parse(manifestRaw.toString('utf-8')) as CommunityDatasetManifest;
  for (const [filename, meta] of Object.entries(manifest.files)) {
    const content = await storage.getObject({ bucket, key: getCommunityDatasetKey(snapshotId, platform, filename) });
    if (sha256(content) !== meta.sha256) {
      throw new Error(
        `Committed community_${platform} dataset for snapshot ${snapshotId} failed hash verification on ${filename}; refusing to overwrite or reuse it`,
      );
    }
  }
  return manifest;
}

/**
 * Fetches and freezes one platform's snapshot dataset:
 * `snapshots/{id}/community_{platform}/{activities,coverage}.parquet` plus
 * `manifest.json`, written last as the commit — a dataset without a manifest
 * does not exist, and a retry that finds one verifies hashes and stops.
 *
 * The engine is platform-neutral: everything platform-specific arrives
 * through the injected `CommunityAdapter`. Records are staged as durable S3
 * segments while crawling (so a retry resumes from the heartbeat checkpoint),
 * then loaded into DuckDB, deduplicated on the canonical record identity,
 * window-filtered, stably ordered, and exported as zstd Parquet — identical
 * input yields byte-identical files.
 */
export async function freezeCommunityDataset(
  input: FreezeCommunityDatasetInput,
): Promise<FreezeCommunityDatasetResult> {
  const { snapshotId, platform, window, resourceIds, adapter, storage, bucket, requestStats, progress, logger } = input;

  assertIsoInstant(window.start, 'window start');
  assertIsoInstant(window.end, 'window end');
  if (resourceIds.length === 0) {
    throw new Error(`Community ${platform} fetch received no selected resources`);
  }

  const existing = await readCommittedManifest(storage, bucket, snapshotId, platform);
  if (existing) {
    logger.info('Community dataset already committed and verified; skipping fetch', { snapshotId, platform });
    return { committed: false, manifest: existing };
  }

  const scratch = await mkdtemp(join(tmpdir(), `reputo-community-${platform}-`));
  try {
    const checkpoint = normalizeCheckpoint(progress.lastCheckpoint);
    const statsBase = checkpoint.stats;
    const attemptStartedAt = Date.now();
    let attemptPages = 0;
    let attemptRows = 0;

    const liveStats = (): CommunityFetchStats => ({
      requests: statsBase.requests + requestStats.requests,
      pages: statsBase.pages + attemptPages,
      rows: statsBase.rows + attemptRows,
      rateLimitWaits: statsBase.rateLimitWaits + requestStats.rateLimitWaits,
      rateLimitWaitMs: statsBase.rateLimitWaitMs + requestStats.rateLimitWaitMs,
      durationMs: statsBase.durationMs + (Date.now() - attemptStartedAt),
    });
    const beat = () => {
      progress.heartbeat(structuredClone({ ...checkpoint, stats: liveStats() }));
    };

    for (const resourceId of resourceIds) {
      checkpoint.resources[resourceId] ??= { segments: 0 };
      const resource = checkpoint.resources[resourceId];
      if (resource.coverage) {
        logger.info('Resource already crawled in a previous attempt; skipping', { resourceId });
        continue;
      }

      let buffered: string[] = [];
      const flushSegment = async (cursor: string | undefined) => {
        if (buffered.length > 0) {
          const key = segmentKey(snapshotId, platform, resourceId, resource.segments);
          await storage.putObject({
            bucket,
            key,
            body: await gzipAsync(buffered.join('\n')),
            contentType: 'application/gzip',
          });
          resource.segments += 1;
          buffered = [];
        }
        resource.cursor = cursor;
      };

      const iterator = adapter.iterateRecords({ resourceId, window, cursor: resource.cursor });
      for (;;) {
        const step = await iterator.next();
        if (step.done) {
          await flushSegment(undefined);
          resource.coverage = step.value;
          delete resource.cursor;
          beat();
          break;
        }

        attemptPages += 1;
        attemptRows += step.value.records.length;
        buffered.push(...step.value.records.map(toNdjsonLine));
        if (buffered.length >= SEGMENT_MAX_ROWS) {
          await flushSegment(step.value.cursor);
        } else if (buffered.length === 0) {
          // Nothing pending, so the cursor may advance without an upload.
          resource.cursor = step.value.cursor;
        }
        beat();
      }

      logger.info('Resource crawl finished', { resourceId, coverage: resource.coverage });
    }

    const coverages = resourceIds
      .map((id) => checkpoint.resources[id]?.coverage)
      .filter((coverage): coverage is CommunityResourceCoverage => coverage !== undefined);
    if (coverages.every((coverage) => coverage.status === 'failed')) {
      const reasons = [...new Set(coverages.map((coverage) => coverage.reason ?? 'unknown'))].join(', ');
      throw new Error(
        `Community ${platform} fetch failed: none of the ${resourceIds.length} selected resources could be read (${reasons})`,
      );
    }

    const manifest = await exportAndCommit({
      snapshotId,
      platform,
      window,
      checkpoint,
      resourceIds,
      coverages,
      storage,
      bucket,
      scratch,
      stats: liveStats,
      beat,
      logger,
    });

    return { committed: true, manifest };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

async function exportAndCommit(args: {
  snapshotId: string;
  platform: string;
  window: CommunityFetchWindow;
  checkpoint: CommunityFetchCheckpoint;
  resourceIds: string[];
  coverages: CommunityResourceCoverage[];
  storage: Storage;
  bucket: string;
  scratch: string;
  stats: () => CommunityFetchStats;
  beat: () => void;
  logger: CommunityEngineLogger;
}): Promise<CommunityDatasetManifest> {
  const { snapshotId, platform, window, checkpoint, resourceIds, coverages, storage, bucket, scratch, logger } = args;

  const segmentDir = join(scratch, 'segments');
  const duckdbTmpDir = join(scratch, 'duckdb-tmp');
  await mkdir(segmentDir);
  await mkdir(duckdbTmpDir);

  const localSegments: string[] = [];
  for (const resourceId of resourceIds) {
    const progress = checkpoint.resources[resourceId];
    for (let index = 0; index < (progress?.segments ?? 0); index += 1) {
      const local = join(segmentDir, `seg-${String(localSegments.length).padStart(6, '0')}.ndjson.gz`);
      const body = await storage.getObject({ bucket, key: segmentKey(snapshotId, platform, resourceId, index) });
      await writeFile(local, body);
      localSegments.push(local);
      args.beat();
    }
  }

  const instance = await DuckDBInstance.create(':memory:', {
    memory_limit: DUCKDB_MEMORY_LIMIT,
    threads: DUCKDB_THREADS,
    temp_directory: duckdbTmpDir,
  });
  const connection = await instance.connect();
  const activitiesPath = join(scratch, COMMUNITY_ACTIVITIES_FILENAME);
  const coveragePath = join(scratch, COMMUNITY_COVERAGE_FILENAME);
  let duckdbVersion: string;
  let activityRows: number;
  try {
    await connection.run(
      'CREATE TABLE staged (type VARCHAR, actor VARCHAR, counterparty VARCHAR, resource VARCHAR, ' +
        'object_id VARCHAR, occurred_at TIMESTAMP, count BIGINT, bot BOOLEAN, deleted BOOLEAN)',
    );
    if (localSegments.length > 0) {
      const fileList = localSegments.map((path) => `'${path.replaceAll("'", "''")}'`).join(', ');
      await connection.run(
        `INSERT INTO staged SELECT type, actor, counterparty, resource, object_id, occurred_at, count, bot, deleted ` +
          `FROM read_json([${fileList}], format='newline_delimited', columns=${ACTIVITY_COLUMN_TYPES})`,
      );
    }

    // Deduplicate on the canonical record identity so overlapping segments
    // from resumed crawls collapse to one row, then export in a stable total
    // order: identical input yields byte-identical Parquet.
    await connection.run(
      `COPY (
         SELECT actor, counterparty, type, resource, object_id, occurred_at,
                max(count) AS count, bool_or(bot) AS bot, bool_or(deleted) AS deleted
         FROM staged
         WHERE occurred_at >= TIMESTAMP '${window.start}' AND occurred_at < TIMESTAMP '${window.end}'
         GROUP BY actor, counterparty, type, resource, object_id, occurred_at
         ORDER BY occurred_at, type, actor, object_id, counterparty NULLS FIRST, resource
       ) TO '${activitiesPath.replaceAll("'", "''")}' (FORMAT parquet, COMPRESSION zstd)`,
    );

    await connection.run('CREATE TABLE coverage (resource VARCHAR, status VARCHAR, reason VARCHAR)');
    const insertCoverage = await connection.prepare('INSERT INTO coverage VALUES ($1, $2, $3)');
    for (const coverage of coverages) {
      insertCoverage.bindVarchar(1, coverage.resource);
      insertCoverage.bindVarchar(2, coverage.status);
      if (coverage.reason === undefined) {
        insertCoverage.bindNull(3);
      } else {
        insertCoverage.bindVarchar(3, coverage.reason);
      }
      await insertCoverage.run();
    }
    await connection.run(
      `COPY (SELECT resource, status, reason FROM coverage ORDER BY resource) ` +
        `TO '${coveragePath.replaceAll("'", "''")}' (FORMAT parquet, COMPRESSION zstd)`,
    );

    const versionResult = await connection.runAndReadAll('SELECT version() AS version');
    duckdbVersion = String(versionResult.getRowObjects()[0]?.version ?? 'unknown');
    const countResult = await connection.runAndReadAll(
      `SELECT count(*) AS rows FROM read_parquet('${activitiesPath.replaceAll("'", "''")}')`,
    );
    activityRows = Number(countResult.getRowObjects()[0]?.rows ?? 0);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
  args.beat();

  const [activitiesBytes, coverageBytes] = await Promise.all([readFile(activitiesPath), readFile(coveragePath)]);
  await storage.putObject({
    bucket,
    key: getCommunityDatasetKey(snapshotId, platform, COMMUNITY_ACTIVITIES_FILENAME),
    body: activitiesBytes,
    contentType: 'application/octet-stream',
  });
  await storage.putObject({
    bucket,
    key: getCommunityDatasetKey(snapshotId, platform, COMMUNITY_COVERAGE_FILENAME),
    body: coverageBytes,
    contentType: 'application/octet-stream',
  });

  const manifest: CommunityDatasetManifest = {
    schemaVersion: COMMUNITY_DATASET_SCHEMA_VERSION,
    platform,
    snapshotId,
    window,
    files: {
      [COMMUNITY_ACTIVITIES_FILENAME]: {
        sha256: sha256(activitiesBytes),
        bytes: activitiesBytes.byteLength,
        rows: activityRows,
      },
      [COMMUNITY_COVERAGE_FILENAME]: {
        sha256: sha256(coverageBytes),
        bytes: coverageBytes.byteLength,
        rows: coverages.length,
      },
    },
    fetchStats: args.stats(),
    duckdb: { version: duckdbVersion },
  };

  // The manifest is the commit: everything before this write is invisible to
  // consumers, and everything after it is immutable.
  await storage.putObject({
    bucket,
    key: getCommunityDatasetKey(snapshotId, platform, COMMUNITY_MANIFEST_FILENAME),
    body: JSON.stringify(manifest),
    contentType: 'application/json',
  });

  const stagingKeys = await storage.listObjectsByPrefix({
    bucket,
    prefix: getCommunityStagingPrefix(snapshotId, platform),
  });
  if (stagingKeys.length > 0) {
    await storage.deleteObjects({ bucket, keys: stagingKeys });
  }

  logger.info('Community dataset committed', {
    snapshotId,
    platform,
    activityRows,
    coverageRows: coverages.length,
    stagingSegmentsDeleted: stagingKeys.length,
  });

  return manifest;
}
