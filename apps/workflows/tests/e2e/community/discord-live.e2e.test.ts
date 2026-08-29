import { createHash } from 'node:crypto';
import { createDiscordAdapter } from '@reputo/community-api';
import type { Storage } from '@reputo/storage';
import { describe, expect, it, vi } from 'vitest';
import {
  type CommunityFetchCheckpoint,
  freezeCommunityDataset,
} from '../../../src/activities/community/dataset-engine.js';
import { createInMemoryStorage, TEST_BUCKET } from '../utils/in-memory-storage.js';

/**
 * Live contract test against a real guild — verifies the fields the crawl
 * depends on arrive without privileged intents and measures the crawl rate.
 * Gated like the other externally-dependent suites. Run with:
 *
 *   RUN_DISCORD_LIVE_TESTS=true \
 *   DISCORD_BOT_TOKEN=... \
 *   LIVE_DISCORD_CHANNEL_IDS=<comma-separated channel ids> \
 *   [LIVE_DISCORD_LOOKBACK_DAYS=30] \
 *   pnpm --filter @reputo/workflows test:e2e
 */
const gate =
  process.env.RUN_DISCORD_LIVE_TESTS === 'true' &&
  typeof process.env.DISCORD_BOT_TOKEN === 'string' &&
  typeof process.env.LIVE_DISCORD_CHANNEL_IDS === 'string';
const describeMaybe = gate ? describe : describe.skip;

describeMaybe('discord live contract (real guild)', () => {
  it('crawls the selected channels into a committed, hash-verified dataset without privileged intents', async () => {
    const resourceIds = (process.env.LIVE_DISCORD_CHANNEL_IDS as string).split(',').map((id) => id.trim());
    const lookbackDays = Number(process.env.LIVE_DISCORD_LOOKBACK_DAYS ?? 30);
    const windowEnd = new Date();
    const window = {
      start: new Date(windowEnd.getTime() - lookbackDays * 86_400_000).toISOString(),
      end: windowEnd.toISOString(),
    };

    const requestStats = { requests: 0, rateLimitWaits: 0, rateLimitWaitMs: 0 };
    const adapter = createDiscordAdapter(
      {
        botToken: process.env.DISCORD_BOT_TOKEN as string,
        requestTimeoutMs: 15_000,
        retry: { maxAttempts: 4, baseDelayMs: 500, maxDelayMs: 10_000 },
      },
      { debug: () => {}, warn: (payload) => console.warn(payload) },
      {
        onRequest: () => {
          requestStats.requests += 1;
        },
        onRateLimitWait: (delayMs) => {
          requestStats.rateLimitWaits += 1;
          requestStats.rateLimitWaitMs += delayMs;
        },
      },
    );

    const storage = createInMemoryStorage();
    const heartbeats: CommunityFetchCheckpoint[] = [];
    const startedAt = Date.now();

    const result = await freezeCommunityDataset({
      snapshotId: 'snap-live',
      platform: 'discord',
      window,
      resourceIds,
      adapter,
      storage: storage as unknown as Storage,
      bucket: TEST_BUCKET,
      requestStats,
      progress: { heartbeat: (checkpoint) => heartbeats.push(checkpoint) },
      logger: { info: (message, attrs) => console.log(message, attrs ?? ''), warn: console.warn },
    });

    const durationMs = Date.now() - startedAt;
    console.log('live crawl', {
      durationMs,
      requestsPerSecond: result.manifest.fetchStats.requests / Math.max(1, durationMs / 1_000),
      fetchStats: result.manifest.fetchStats,
      coverageRows: result.manifest.files['coverage.parquet'].rows,
    });

    expect(result.committed).toBe(true);
    expect(heartbeats.length).toBeGreaterThan(0);

    // The committed dataset's hashes verify against the stored bytes.
    for (const [filename, meta] of Object.entries(result.manifest.files)) {
      const bytes = storage.readObject(`snapshots/snap-live/community_discord/${filename}`) as Buffer;
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
    }

    // First writer wins on a rerun of the same snapshot.
    const rerun = await freezeCommunityDataset({
      snapshotId: 'snap-live',
      platform: 'discord',
      window,
      resourceIds,
      adapter,
      storage: storage as unknown as Storage,
      bucket: TEST_BUCKET,
      requestStats,
      progress: { heartbeat: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn() },
    });
    expect(rerun.committed).toBe(false);
  }, 1_800_000);
});
