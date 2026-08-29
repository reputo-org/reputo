import type { CommunityActivityRecord, CommunityAdapter } from '@reputo/community-api';
import type { Storage } from '@reputo/storage';
import { describe, expect, it, vi } from 'vitest';
import { freezeCommunityDataset } from '../../../src/activities/community/dataset-engine.js';
import { createInMemoryStorage, TEST_BUCKET } from '../utils/in-memory-storage.js';

// Gated like the Postgres-backed suite: generating and freezing ~1M rows takes
// tens of seconds and does not belong in the free-tier CI job. Run with:
// RUN_COMMUNITY_SCALE_TESTS=true pnpm --filter @reputo/workflows test:e2e
const describeMaybe = process.env.RUN_COMMUNITY_SCALE_TESTS === 'true' ? describe : describe.skip;

const TOTAL_ROWS = 1_000_000;
const BATCH_SIZE = 500;
const WINDOW = { start: '2026-02-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' };

/** Deterministic synthetic activity spread across users, days, and types. */
function syntheticRecord(index: number): CommunityActivityRecord {
  const day = index % 180;
  const occurredAt = new Date(Date.parse(WINDOW.start) + day * 86_400_000 + (index % 86_400) * 1_000).toISOString();
  return {
    type: index % 5 === 0 ? 'reaction_received' : index % 3 === 0 ? 'reply' : 'message',
    actor: `user-${index % 2_000}`,
    counterparty: index % 3 === 0 ? `user-${(index + 7) % 2_000}` : null,
    resource: 'c1',
    objectId: `m-${index}`,
    occurredAt,
    count: index % 5 === 0 ? (index % 9) + 1 : 1,
    actorIsBot: index % 97 === 0,
    deleted: false,
  };
}

const scaleAdapter: CommunityAdapter = {
  platform: 'discord',
  listResources: async () => [],
  probe: async () => ({ resourceCount: 1, sampledRecordCount: 0 }),
  async *iterateRecords() {
    for (let offset = 0; offset < TOTAL_ROWS; offset += BATCH_SIZE) {
      const records = Array.from({ length: BATCH_SIZE }, (_, inner) => syntheticRecord(offset + inner));
      yield { records, cursor: String(offset + BATCH_SIZE) };
    }
    return { resource: 'c1', status: 'complete' as const };
  },
};

describeMaybe('community dataset engine at SNET scale', () => {
  it('freezes a ~1M-row synthetic crawl within the DuckDB memory limit', async () => {
    const storage = createInMemoryStorage();
    const startedAt = Date.now();

    const result = await freezeCommunityDataset({
      snapshotId: 'snap-scale',
      platform: 'discord',
      window: WINDOW,
      resourceIds: ['c1'],
      adapter: scaleAdapter,
      storage: storage as unknown as Storage,
      bucket: TEST_BUCKET,
      requestStats: { requests: 0, rateLimitWaits: 0, rateLimitWaitMs: 0 },
      progress: { heartbeat: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn() },
    });

    const activitiesFile = result.manifest.files['activities.parquet'];
    // eslint-disable-next-line no-console
    console.log('scale run', {
      durationMs: Date.now() - startedAt,
      parquetBytes: activitiesFile.bytes,
      rows: activitiesFile.rows,
      rssMb: Math.round(process.memoryUsage().rss / 1_048_576),
    });

    expect(result.committed).toBe(true);
    expect(activitiesFile.rows).toBe(TOTAL_ROWS);
    // Doc expectation: SNET-scale datasets land in the tens of MB.
    expect(activitiesFile.bytes).toBeLessThan(100 * 1_048_576);
  }, 600_000);
});
