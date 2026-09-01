import { createHash } from 'node:crypto';
import { createGitHubAdapter } from '@reputo/community-api';
import type { Storage } from '@reputo/storage';
import { describe, expect, it, vi } from 'vitest';
import {
  type CommunityFetchCheckpoint,
  freezeCommunityDataset,
} from '../../../src/activities/community/dataset-engine.js';
import { createInMemoryStorage, TEST_BUCKET } from '../utils/in-memory-storage.js';

/**
 * Live contract test against a real installation — verifies the App's granted
 * permissions, the pagination boundaries, and how much of the installation's
 * hourly budget one crawl actually spends. Gated like the other
 * externally-dependent suites. Run with:
 *
 *   RUN_GITHUB_LIVE_TESTS=true \
 *   GITHUB_APP_ID=... GITHUB_APP_PRIVATE_KEY="$(cat app.pem)" \
 *   LIVE_GITHUB_INSTALLATION_ID=<installation id> \
 *   [LIVE_GITHUB_REPOSITORY_IDS=<comma-separated repository ids>] \
 *   [LIVE_GITHUB_LOOKBACK_DAYS=30] \
 *   [LIVE_GITHUB_LOGIN=<github login>] \
 *   pnpm --filter @reputo/workflows test:e2e
 */
const gate =
  process.env.RUN_GITHUB_LIVE_TESTS === 'true' &&
  typeof process.env.GITHUB_APP_ID === 'string' &&
  typeof process.env.GITHUB_APP_PRIVATE_KEY === 'string' &&
  typeof process.env.LIVE_GITHUB_INSTALLATION_ID === 'string';
const describeMaybe = gate ? describe : describe.skip;

const itLogin = gate && typeof process.env.LIVE_GITHUB_LOGIN === 'string' ? it : it.skip;

const installationId = () => process.env.LIVE_GITHUB_INSTALLATION_ID as string;

const liveAdapter = (requestStats = { requests: 0, rateLimitWaits: 0, rateLimitWaitMs: 0 }) =>
  createGitHubAdapter(
    {
      appId: process.env.GITHUB_APP_ID as string,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY as string,
      installationId: installationId(),
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

describeMaybe('github live contract (real installation)', () => {
  it('crawls the selected repositories into a committed, hash-verified dataset within the installation budget', async () => {
    const requestStats = { requests: 0, rateLimitWaits: 0, rateLimitWaitMs: 0 };
    const adapter = liveAdapter(requestStats);

    const selected = process.env.LIVE_GITHUB_REPOSITORY_IDS?.split(',').map((id) => id.trim());
    const resourceIds = selected ?? (await adapter.listResources(installationId())).slice(0, 3).map((repo) => repo.id);
    expect(resourceIds.length).toBeGreaterThan(0);

    const lookbackDays = Number(process.env.LIVE_GITHUB_LOOKBACK_DAYS ?? 30);
    const windowEnd = new Date();
    const window = {
      start: new Date(windowEnd.getTime() - lookbackDays * 86_400_000).toISOString(),
      end: windowEnd.toISOString(),
    };

    const storage = createInMemoryStorage();
    const heartbeats: CommunityFetchCheckpoint[] = [];
    const startedAt = Date.now();

    const result = await freezeCommunityDataset({
      snapshotId: 'snap-github-live',
      platform: 'github',
      window,
      resourceIds,
      adapter,
      storage: storage as unknown as Storage,
      bucket: TEST_BUCKET,
      fetchCohort: async () => [],
      requestStats,
      progress: { heartbeat: (checkpoint) => heartbeats.push(checkpoint) },
      logger: { info: (message, attrs) => console.log(message, attrs ?? ''), warn: console.warn },
    });

    const rateLimit = adapter.rateLimit();
    console.log('live crawl', {
      durationMs: Date.now() - startedAt,
      fetchStats: result.manifest.fetchStats,
      // The number this task's budget estimate has to be checked against.
      requestsVsBudget: rateLimit && `${result.manifest.fetchStats.requests} of ${rateLimit.limit}/h`,
      rateLimit,
      coverageRows: result.manifest.files['coverage.parquet'].rows,
    });

    expect(result.committed).toBe(true);
    expect(heartbeats.length).toBeGreaterThan(0);
    // The App's budget must comfortably outlast one crawl, or a production run
    // would stall mid-snapshot.
    expect(rateLimit?.remaining ?? 0).toBeGreaterThan(0);

    for (const [filename, meta] of Object.entries(result.manifest.files)) {
      const bytes = storage.readObject(`snapshots/snap-github-live/community_github/${filename}`) as Buffer;
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
    }

    // First writer wins on a rerun of the same snapshot.
    const rerun = await freezeCommunityDataset({
      snapshotId: 'snap-github-live',
      platform: 'github',
      window,
      resourceIds,
      adapter,
      storage: storage as unknown as Storage,
      bucket: TEST_BUCKET,
      fetchCohort: async () => [],
      requestStats,
      progress: { heartbeat: vi.fn() },
      logger: { info: vi.fn(), warn: vi.fn() },
    });
    expect(rerun.committed).toBe(false);
  }, 1_800_000);

  /**
   * The cohort match depends on the installation being able to read public user
   * profiles. A failure here means every GitHub snapshot would publish zeros.
   */
  itLogin(
    'resolves a login to its stable account id and refuses to guess an unknown one',
    async () => {
      const adapter = liveAdapter();

      await expect(adapter.searchMemberId(installationId(), process.env.LIVE_GITHUB_LOGIN as string)).resolves.toMatch(
        /^\d+$/,
      );
      await expect(adapter.searchMemberId(installationId(), 'reputo-nonexistent-login-check')).resolves.toBeNull();
    },
    120_000,
  );
});
