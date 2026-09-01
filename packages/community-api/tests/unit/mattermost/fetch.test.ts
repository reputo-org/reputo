import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMattermostAdapter } from '../../../src/mattermost/adapter.js';
import { MATTERMOST_POSTS_PER_PAGE } from '../../../src/mattermost/fetch.js';
import type { MattermostAdapterConfig, MattermostRawPost } from '../../../src/mattermost/types.js';
import type { CommunityRecordBatch, CommunityResourceCoverage } from '../../../src/shared/records.js';
import { createStubLogger, TEST_HTTP_CONFIG } from '../../utils/mock-helpers.js';

const TOKEN = 'mm-secret-token';
const WINDOW = { start: '2026-06-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' };

const at = (iso: string): number => Date.parse(iso);

const post = (overrides: Partial<MattermostRawPost> & { id: string }): MattermostRawPost => ({
  user_id: 'u1',
  create_at: at('2026-07-01T10:00:00.000Z'),
  delete_at: 0,
  root_id: '',
  type: '',
  message: 'hello',
  ...overrides,
});

/** A channel's history, newest first — the order the endpoint answers in. */
type History = MattermostRawPost[];

interface Recorded {
  path: string;
  body: string;
}

describe('mattermost record iterator', () => {
  let server: Server;
  let serverUrl: string;
  const requests: Recorded[] = [];
  const history = new Map<string, History>();
  const deny = new Set<string>();
  const users = new Map<string, { id: string; username: string; is_bot?: boolean }>();

  const handle = (request: IncomingMessage, response: ServerResponse): void => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const url = request.url ?? '';
      requests.push({ path: url, body: Buffer.concat(chunks).toString('utf8') });
      const respond = (body: unknown, statusCode = 200): void => {
        response.statusCode = statusCode;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(body));
      };

      if (url === '/api/v4/users/me/teams/team-1/channels') {
        respond([{ id: 'chan-1', name: 'town-square', display_name: 'Town Square', type: 'O', delete_at: 0 }]);
        return;
      }

      if (url.startsWith('/api/v4/users/ids') || url.startsWith('/api/v4/users/usernames')) {
        const requested = JSON.parse(Buffer.concat(chunks).toString('utf8') || '[]') as string[];
        const byId = url.includes('/ids');
        respond([...users.values()].filter((user) => requested.includes(byId ? user.id : user.username)));
        return;
      }

      const [, , , , channelId] = url.split('/');
      if (deny.has(channelId)) {
        respond({ id: 'api.context.permissions.app_error' }, 403);
        return;
      }

      const posts = history.get(channelId) ?? [];
      const query = new URLSearchParams(url.slice(url.indexOf('?') + 1));
      const perPage = Number(query.get('per_page') ?? 60);
      const before = query.get('before');
      const start = before === null ? 0 : posts.findIndex((entry) => entry.id === before) + 1;
      const page = posts.slice(start, start + perPage);

      // The endpoint also returns the thread roots of any reply on the page.
      const carried = new Map(page.map((entry) => [String(entry.id), entry]));
      for (const entry of page) {
        const root = typeof entry.root_id === 'string' ? posts.find((other) => other.id === entry.root_id) : undefined;
        if (root !== undefined) {
          carried.set(String(root.id), root);
        }
      }
      respond({ order: page.map((entry) => entry.id), posts: Object.fromEntries(carried) });
    });
  };

  const adapter = () =>
    createMattermostAdapter(
      {
        ...TEST_HTTP_CONFIG,
        outbound: { allowedHosts: ['127.0.0.1'], maxResponseBytes: 1_048_576 },
        target: { serverUrl, token: TOKEN, teamId: 'team-1' },
      } satisfies MattermostAdapterConfig,
      createStubLogger(),
    );

  /** Drains one channel crawl into its batches and final coverage. */
  async function crawl(resourceId: string, cursor?: string) {
    const batches: CommunityRecordBatch[] = [];
    const iterator = adapter().iterateRecords({ resourceId, window: WINDOW, cursor });
    for (;;) {
      const step = await iterator.next();
      if (step.done) {
        return { batches, coverage: step.value as CommunityResourceCoverage };
      }
      batches.push(step.value);
    }
  }

  const rowsOf = (batches: CommunityRecordBatch[]) => batches.flatMap((batch) => batch.records);

  const postPaths = () => requests.map((entry) => entry.path).filter((path) => path.includes('/posts'));

  beforeAll(async () => {
    server = createServer(handle);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  beforeEach(() => {
    requests.length = 0;
    history.clear();
    deny.clear();
    users.clear();
    users.set('u1', { id: 'u1', username: 'alice' });
    users.set('u2', { id: 'u2', username: 'bob' });
    users.set('bot-1', { id: 'bot-1', username: 'webhook', is_bot: true });
  });

  it('crawls one channel into rows and reports complete coverage', async () => {
    history.set('chan-1', [
      post({ id: 'p3', user_id: 'bot-1', create_at: at('2026-07-03T10:00:00.000Z') }),
      post({ id: 'p2', user_id: 'u2', root_id: 'p1', create_at: at('2026-07-02T10:00:00.000Z') }),
      post({ id: 'p1', create_at: at('2026-07-01T10:00:00.000Z'), metadata: { reactions: [{ user_id: 'u2' }] } }),
    ]);

    const { batches, coverage } = await crawl('chan-1');

    expect(coverage).toEqual({ resource: 'chan-1', status: 'complete' });
    expect(rowsOf(batches)).toEqual([
      expect.objectContaining({ type: 'message', actor: 'bot-1', actorIsBot: true, objectId: 'p3' }),
      expect.objectContaining({ type: 'reply', actor: 'u2', counterparty: 'u1', objectId: 'p2' }),
      expect.objectContaining({ type: 'reply_received', actor: 'u1', counterparty: 'u2', objectId: 'p2' }),
      expect.objectContaining({ type: 'message', actor: 'u1', objectId: 'p1' }),
      expect.objectContaining({ type: 'reaction_received', actor: 'u1', counterparty: 'u2', count: 1 }),
    ]);
  });

  it('resolves the is_bot flag in one bulk lookup and reuses it across pages', async () => {
    history.set('chan-1', [post({ id: 'p1' }), post({ id: 'p2', user_id: 'u2' })]);
    history.set('chan-2', [post({ id: 'p3', user_id: 'bot-1' })]);

    await crawl('chan-1');
    const idLookups = requests.filter((entry) => entry.path.includes('/users/ids'));

    expect(idLookups).toHaveLength(1);
    expect(JSON.parse(idLookups[0].body)).toEqual(['u1', 'u2']);
  });

  it('pages backwards from the oldest post read and stops at the window start', async () => {
    const inWindow = Array.from({ length: MATTERMOST_POSTS_PER_PAGE }, (_, index) =>
      post({ id: `p${index}`, create_at: at('2026-07-01T10:00:00.000Z') - index * 60_000 }),
    );
    // The page holding the first out-of-window post ends the walk.
    history.set('chan-1', [
      ...inWindow,
      post({ id: 'old', create_at: at('2026-05-01T10:00:00.000Z') }),
      post({ id: 'older', create_at: at('2026-04-01T10:00:00.000Z') }),
    ]);

    const { batches, coverage } = await crawl('chan-1');

    expect(postPaths()).toEqual([
      `/api/v4/channels/chan-1/posts?per_page=${MATTERMOST_POSTS_PER_PAGE}&page=0`,
      `/api/v4/channels/chan-1/posts?per_page=${MATTERMOST_POSTS_PER_PAGE}&before=p199`,
    ]);
    expect(coverage.status).toBe('complete');
    // The out-of-window posts are read but never scored.
    expect(rowsOf(batches)).toHaveLength(MATTERMOST_POSTS_PER_PAGE);
  });

  it('never asks for the `since` window sync, which truncates server-side', async () => {
    history.set('chan-1', [post({ id: 'p1' })]);

    await crawl('chan-1');

    expect(postPaths().every((path) => !path.includes('since='))).toBe(true);
  });

  it('advances past a full page of system posts instead of ending the walk there', async () => {
    const noise = Array.from({ length: MATTERMOST_POSTS_PER_PAGE }, (_, index) =>
      post({
        id: `sys${index}`,
        type: 'system_join_channel',
        create_at: at('2026-07-10T10:00:00.000Z') - index * 60_000,
      }),
    );
    history.set('chan-1', [...noise, post({ id: 'p1' })]);

    const { batches } = await crawl('chan-1');

    expect(postPaths()).toHaveLength(2);
    expect(rowsOf(batches)).toEqual([expect.objectContaining({ type: 'message', objectId: 'p1' })]);
  });

  it('resumes from a cursor instead of restarting the channel', async () => {
    history.set('chan-1', [
      post({ id: 'p2', create_at: at('2026-07-02T10:00:00.000Z') }),
      post({ id: 'p1', create_at: at('2026-07-01T10:00:00.000Z') }),
    ]);

    const { batches } = await crawl('chan-1', JSON.stringify({ before: 'p2' }));

    expect(postPaths()).toEqual([`/api/v4/channels/chan-1/posts?per_page=${MATTERMOST_POSTS_PER_PAGE}&before=p2`]);
    expect(rowsOf(batches)).toEqual([expect.objectContaining({ objectId: 'p1' })]);
  });

  it('restarts the channel when the cursor is unreadable', async () => {
    history.set('chan-1', [post({ id: 'p1' })]);

    const { batches } = await crawl('chan-1', 'not-json');

    expect(postPaths()).toEqual([`/api/v4/channels/chan-1/posts?per_page=${MATTERMOST_POSTS_PER_PAGE}&page=0`]);
    expect(rowsOf(batches)).toHaveLength(1);
  });

  it('reports an uninvited private channel as failed coverage with a safe reason', async () => {
    deny.add('chan-private');

    const { batches, coverage } = await crawl('chan-private');

    expect(coverage).toEqual({ resource: 'chan-private', status: 'failed', reason: 'permission_denied' });
    expect(rowsOf(batches)).toEqual([]);
  });

  it('downgrades to partial coverage when access is lost after progress was proven', async () => {
    deny.add('chan-1');

    const { coverage } = await crawl('chan-1', JSON.stringify({ before: 'p9' }));

    expect(coverage).toEqual({ resource: 'chan-1', status: 'partial', reason: 'posts:permission_denied' });
  });

  it('lists and probes through the connect client, so a connection is judged by the same code', async () => {
    history.set('chan-1', [post({ id: 'p1' })]);

    expect(await adapter().listResources('irrelevant')).toEqual([{ id: 'chan-1', name: 'Town Square', kind: 'text' }]);
    expect(await adapter().probe('irrelevant')).toEqual({
      resourceCount: 1,
      sampledResourceId: 'chan-1',
      sampledRecordCount: 1,
    });
  });

  it('resolves cohort usernames in one bulk call and leaves unknown ones unmatched', async () => {
    const resolved = await adapter().searchMemberIds?.('irrelevant', ['alice', 'ghost', 'bob']);

    expect(resolved && [...resolved]).toEqual([
      ['alice', 'u1'],
      ['ghost', null],
      ['bob', 'u2'],
    ]);
    expect(requests).toHaveLength(1);
    expect(await adapter().searchMemberId('irrelevant', 'ghost')).toBeNull();
  });
});
