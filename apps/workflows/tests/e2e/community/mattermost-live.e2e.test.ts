import { createHash } from 'node:crypto';
import { createMattermostAdapter, executeSafeRequest, normalizeMattermostServerUrl } from '@reputo/community-api';
import type { Storage } from '@reputo/storage';
import { describe, expect, it } from 'vitest';
import {
  type CommunityFetchCheckpoint,
  freezeCommunityDataset,
} from '../../../src/activities/community/dataset-engine.js';
import { createInMemoryStorage, TEST_BUCKET } from '../utils/in-memory-storage.js';

/**
 * Live contract test against a real Mattermost server — run once per entry of
 * the supported version matrix (the minimum supported ESR and the current
 * release). It verifies the crawl's keyset pagination, private-channel
 * visibility, deletion behaviour, and the `since` sync's documented truncation,
 * and prints the server version so the findings can be recorded per version.
 * Gated like the other externally-dependent suites. Run with:
 *
 *   RUN_MATTERMOST_LIVE_TESTS=true \
 *   LIVE_MATTERMOST_SERVER_URL=https://chat.example.com \
 *   LIVE_MATTERMOST_TOKEN=<bot token> \
 *   LIVE_MATTERMOST_TEAM_ID=<team id> \
 *   LIVE_MATTERMOST_CHANNEL_IDS=<comma-separated channel ids> \
 *   [LIVE_MATTERMOST_LOOKBACK_DAYS=30] \
 *   [LIVE_MATTERMOST_ALLOWED_HOSTS=<comma-separated hosts>] \
 *   [LIVE_MATTERMOST_PRIVATE_CHANNEL_ID=<a channel the bot is NOT in>] \
 *   [LIVE_MATTERMOST_USERNAME=<a username on the server>] \
 *   pnpm --filter @reputo/workflows test:e2e
 */
const gate =
  process.env.RUN_MATTERMOST_LIVE_TESTS === 'true' &&
  typeof process.env.LIVE_MATTERMOST_SERVER_URL === 'string' &&
  typeof process.env.LIVE_MATTERMOST_TOKEN === 'string' &&
  typeof process.env.LIVE_MATTERMOST_TEAM_ID === 'string' &&
  typeof process.env.LIVE_MATTERMOST_CHANNEL_IDS === 'string';
const describeMaybe = gate ? describe : describe.skip;

const itPrivate = gate && typeof process.env.LIVE_MATTERMOST_PRIVATE_CHANNEL_ID === 'string' ? it : it.skip;
const itUsername = gate && typeof process.env.LIVE_MATTERMOST_USERNAME === 'string' ? it : it.skip;

const target = () => ({
  serverUrl: process.env.LIVE_MATTERMOST_SERVER_URL as string,
  token: process.env.LIVE_MATTERMOST_TOKEN as string,
  teamId: process.env.LIVE_MATTERMOST_TEAM_ID as string,
});

const outbound = () => ({
  allowedHosts: (process.env.LIVE_MATTERMOST_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter((host) => host.length > 0),
  maxResponseBytes: 5 * 1024 * 1024,
});

const HTTP = { requestTimeoutMs: 15_000, retry: { maxAttempts: 4, baseDelayMs: 500, maxDelayMs: 10_000 } };
const logger = { debug: () => {}, warn: (payload: object) => console.warn(payload) };

const liveAdapter = (requestStats = { requests: 0, rateLimitWaits: 0, rateLimitWaitMs: 0 }) =>
  createMattermostAdapter({ ...HTTP, outbound: outbound(), target: target() }, logger, {
    onRequest: () => {
      requestStats.requests += 1;
    },
    onRateLimitWait: (delayMs) => {
      requestStats.rateLimitWaits += 1;
      requestStats.rateLimitWaitMs += delayMs;
    },
  });

/** A raw v4 call, for the contract probes the adapter itself has no reason to make. */
const call = async <T>(path: string): Promise<{ statusCode: number; data: T }> => {
  const origin = normalizeMattermostServerUrl(target().serverUrl);
  const response = await executeSafeRequest<T>(logger, HTTP, outbound(), {
    method: 'GET',
    url: `${origin}/api/v4${path}`,
    headers: { authorization: `Bearer ${target().token}` },
  });
  return { statusCode: response.statusCode, data: response.data };
};

const window = () => {
  const lookbackDays = Number(process.env.LIVE_MATTERMOST_LOOKBACK_DAYS ?? 30);
  const end = new Date();
  return {
    start: new Date(end.getTime() - lookbackDays * 86_400_000).toISOString(),
    end: end.toISOString(),
  };
};

const channelIds = () => (process.env.LIVE_MATTERMOST_CHANNEL_IDS as string).split(',').map((id) => id.trim());

describeMaybe('mattermost live contract (real server)', () => {
  it('reports the server version under test, so the matrix findings are attributable', async () => {
    // `/config/client` is readable by any authenticated account; the plain
    // `/config` endpoint needs system-admin rights the bot does not have.
    const { data } = await call<{ Version?: string; BuildNumber?: string }>('/config/client?format=old');

    console.log('mattermost server', { version: data?.Version, build: data?.BuildNumber });
    expect(typeof data?.Version).toBe('string');
  });

  it('crawls the selected channels into a committed, hash-verified dataset', async () => {
    const requestStats = { requests: 0, rateLimitWaits: 0, rateLimitWaitMs: 0 };
    const adapter = liveAdapter(requestStats);
    const storage = createInMemoryStorage();
    const heartbeats: CommunityFetchCheckpoint[] = [];
    const startedAt = Date.now();

    const result = await freezeCommunityDataset({
      snapshotId: 'snap-live-mm',
      platform: 'mattermost',
      window: window(),
      resourceIds: channelIds(),
      adapter,
      storage: storage as unknown as Storage,
      bucket: TEST_BUCKET,
      fetchCohort: async () => [],
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
    for (const [filename, meta] of Object.entries(result.manifest.files)) {
      const bytes = storage.readObject(`snapshots/snap-live-mm/community_mattermost/${filename}`) as Buffer;
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
    }
  });

  it('paginates history on `before` and never returns a post at or past the cursor', async () => {
    const [channelId] = channelIds();
    const first = await call<{ order: string[]; posts: Record<string, { create_at: number }> }>(
      `/channels/${channelId}/posts?per_page=200&page=0`,
    );
    const order = first.data?.order ?? [];
    if (order.length < 2) {
      console.warn('live pagination check skipped: channel has fewer than two posts');
      return;
    }

    const oldest = order[order.length - 1];
    const next = await call<{ order: string[] }>(`/channels/${channelId}/posts?per_page=200&before=${oldest}`);

    expect(next.data?.order ?? []).not.toContain(oldest);
    for (const id of next.data?.order ?? []) {
      expect(order).not.toContain(id);
    }
  });

  it('confirms the `since` sync ignores per_page and truncates, which is why the crawl does not use it', async () => {
    const [channelId] = channelIds();
    const since = Date.parse(window().start);
    const { data } = await call<{ order: string[] }>(`/channels/${channelId}/posts?since=${since}&per_page=1`);

    // Record the answer per version: `per_page=1` is ignored, and a busy
    // channel comes back capped (1000 on every version measured so far).
    console.log('since sync', { requestedPerPage: 1, returned: (data?.order ?? []).length });
    expect((data?.order ?? []).length).not.toBe(1);
  });

  it('never returns deleted posts to a bot account, so deletions leave the dataset silently', async () => {
    const [channelId] = channelIds();
    const { data } = await call<{ order: string[]; posts: Record<string, { delete_at: number }> }>(
      `/channels/${channelId}/posts?per_page=200&page=0`,
    );

    for (const post of Object.values(data?.posts ?? {})) {
      expect(post.delete_at).toBe(0);
    }
  });

  itPrivate('records a channel the bot was never invited into as coverage, not as silence', async () => {
    const privateChannelId = process.env.LIVE_MATTERMOST_PRIVATE_CHANNEL_ID as string;
    const iterator = liveAdapter().iterateRecords({ resourceId: privateChannelId, window: window() });

    let coverage: unknown;
    for (;;) {
      const step = await iterator.next();
      if (step.done) {
        coverage = step.value;
        break;
      }
      expect(step.value.records).toEqual([]);
    }

    console.log('uninvited private channel', coverage);
    expect(coverage).toMatchObject({ resource: privateChannelId, status: 'failed' });
  });

  itUsername('resolves a real username to its account id in one bulk lookup, and an unknown one to null', async () => {
    const username = (process.env.LIVE_MATTERMOST_USERNAME as string).toLowerCase();
    const resolved = await liveAdapter().searchMemberIds?.(target().teamId, [username, 'reputo-no-such-user']);

    expect(typeof resolved?.get(username)).toBe('string');
    expect(resolved?.get('reputo-no-such-user')).toBeNull();
  });
});
