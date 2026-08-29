import { request } from 'undici';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiscordAdapter } from '../../../src/discord/adapter.js';
import { snowflakeForTimestamp } from '../../../src/discord/transform.js';
import { CommunityHttpError, CommunityRateLimitError } from '../../../src/shared/errors.js';
import type { CommunityRecordBatch, CommunityResourceCoverage } from '../../../src/shared/records.js';
import { createStubLogger, mockUndiciResponse, TEST_HTTP_CONFIG } from '../../utils/mock-helpers.js';

vi.mock('undici', () => ({ request: vi.fn() }));

const mockRequest = vi.mocked(request);
const CONFIG = { ...TEST_HTTP_CONFIG, botToken: 'discord-bot-token' };
const WINDOW = { start: '2026-06-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' };
const END_SNOWFLAKE = snowflakeForTimestamp(WINDOW.end);

const textChannel = { id: 'c1', type: 0, guild_id: 'g1' };
const msg = (id: string, timestamp: string, author = 'alice') => ({ id, type: 0, timestamp, author: { id: author } });

type Responder = (url: string) => { statusCode: number; body: unknown };

/** Routes every mocked call by URL substring; unrouted calls fail the test loudly. */
function installRoutes(routes: Array<[string, Responder]>): string[] {
  const calls: string[] = [];
  mockRequest.mockImplementation(async (rawUrl) => {
    const url = String(rawUrl);
    calls.push(url);
    for (const [needle, respond] of routes) {
      if (url.includes(needle)) {
        const { statusCode, body } = respond(url);
        return mockUndiciResponse(statusCode, body) as never;
      }
    }
    throw new Error(`unrouted request: ${url}`);
  });
  return calls;
}

async function collect(resourceId: string, cursor?: string) {
  const adapter = createDiscordAdapter(CONFIG, createStubLogger());
  const iterator = adapter.iterateRecords({ resourceId, window: WINDOW, cursor });
  const batches: CommunityRecordBatch[] = [];
  for (;;) {
    const step = await iterator.next();
    if (step.done) {
      return { batches, coverage: step.value as CommunityResourceCoverage };
    }
    batches.push(step.value);
  }
}

beforeEach(() => vi.clearAllMocks());

describe('iterateRecords — text channel', () => {
  it('crawls messages, active threads, and archived threads into parent-channel rows', async () => {
    const calls = installRoutes([
      [
        '/channels/c1/messages',
        () => ({
          statusCode: 200,
          body: [msg('900', '2026-07-10T10:00:00.000Z'), msg('100', '2026-01-01T00:00:00.000Z')],
        }),
      ],
      [
        '/channels/c1/threads/archived/public',
        () => ({
          statusCode: 200,
          body: {
            threads: [
              {
                id: 't2',
                type: 11,
                parent_id: 'c1',
                thread_metadata: { archive_timestamp: '2026-07-15T00:00:00.000Z' },
              },
              {
                id: 't3',
                type: 11,
                parent_id: 'c1',
                thread_metadata: { archive_timestamp: '2020-01-01T00:00:00.000Z' },
              },
            ],
            has_more: false,
          },
        }),
      ],
      ['/channels/c1', () => ({ statusCode: 200, body: textChannel })],
      [
        '/guilds/g1/threads/active',
        () => ({
          statusCode: 200,
          body: {
            threads: [
              { id: 't1', type: 11, parent_id: 'c1' },
              { id: 'tx', type: 11, parent_id: 'other-channel' },
              { id: 'tp', type: 12, parent_id: 'c1' },
            ],
          },
        }),
      ],
      ['/channels/t1/messages', () => ({ statusCode: 200, body: [msg('t1m', '2026-07-11T00:00:00.000Z', 'bob')] })],
      ['/channels/t2/messages', () => ({ statusCode: 200, body: [msg('t2m', '2026-07-12T00:00:00.000Z', 'carol')] })],
    ]);

    const { batches, coverage } = await collect('c1');

    expect(coverage).toEqual({ resource: 'c1', status: 'complete' });

    const records = batches.flatMap((batch) => batch.records);
    expect(records.map((record) => record.objectId).sort()).toEqual(['900', 't1m', 't2m']);
    expect(records.every((record) => record.resource === 'c1')).toBe(true);

    // The walk starts exactly at the window end and never touches tx (other
    // parent), tp (private), or t3 (archived before the window start).
    expect(calls.some((url) => url.includes(`/channels/c1/messages?limit=100&before=${END_SNOWFLAKE}`))).toBe(true);
    expect(
      calls.some((url) => url.includes('/channels/tx') || url.includes('/channels/tp') || url.includes('/channels/t3')),
    ).toBe(false);
  });

  it('walks full pages with a before cursor and yields one batch per page', async () => {
    const fullPage = Array.from({ length: 100 }, (_, index) => msg(String(10_000 - index), '2026-07-10T10:00:00.000Z'));
    const calls = installRoutes([
      [
        '/channels/c1/messages',
        (url) => ({
          statusCode: 200,
          body: url.includes(`before=${END_SNOWFLAKE}`) ? fullPage : [msg('42', '2026-07-01T00:00:00.000Z')],
        }),
      ],
      ['/channels/c1/threads/archived/public', () => ({ statusCode: 200, body: { threads: [], has_more: false } })],
      ['/channels/c1', () => ({ statusCode: 200, body: textChannel })],
      ['/guilds/g1/threads/active', () => ({ statusCode: 200, body: { threads: [] } })],
    ]);

    const { batches, coverage } = await collect('c1');

    expect(coverage.status).toBe('complete');
    expect(calls.some((url) => url.includes('before=9901'))).toBe(true);

    const messageBatches = batches.filter((batch) => batch.records.length > 0);
    expect(messageBatches).toHaveLength(2);
    expect(JSON.parse(messageBatches[0].cursor)).toEqual({ phase: 'messages', before: '9901' });
    expect(JSON.parse(messageBatches[1].cursor)).toEqual({ phase: 'threads' });
  });
});

describe('iterateRecords — coverage', () => {
  it('fails the resource when the channel itself is unreadable', async () => {
    installRoutes([['/channels/c1', () => ({ statusCode: 403, body: { message: 'Missing Access' } })]]);

    const { batches, coverage } = await collect('c1');

    expect(batches).toEqual([]);
    expect(coverage).toEqual({ resource: 'c1', status: 'failed', reason: 'permission_denied' });
  });

  it('fails the resource when history is denied before any progress', async () => {
    installRoutes([
      ['/channels/c1/messages', () => ({ statusCode: 403, body: { message: 'Missing Access' } })],
      ['/channels/c1', () => ({ statusCode: 200, body: textChannel })],
    ]);

    const { coverage } = await collect('c1');

    expect(coverage).toEqual({ resource: 'c1', status: 'failed', reason: 'permission_denied' });
  });

  it('records partial coverage when a thread listing is unreadable', async () => {
    installRoutes([
      ['/channels/c1/messages', () => ({ statusCode: 200, body: [msg('900', '2026-07-10T10:00:00.000Z')] })],
      ['/channels/c1/threads/archived/public', () => ({ statusCode: 403, body: { message: 'Missing Access' } })],
      ['/channels/c1', () => ({ statusCode: 200, body: textChannel })],
      ['/guilds/g1/threads/active', () => ({ statusCode: 403, body: { message: 'Missing Access' } })],
    ]);

    const { batches, coverage } = await collect('c1');

    expect(batches.flatMap((batch) => batch.records)).toHaveLength(1);
    expect(coverage.status).toBe('partial');
    expect(coverage.reason).toBe('active_threads:permission_denied; archived_threads:permission_denied');
  });

  it('marks a resource partial when it disappears after earlier progress', async () => {
    installRoutes([['/channels/c1', () => ({ statusCode: 404, body: { message: 'Unknown Channel' } })]]);

    const { coverage } = await collect('c1', JSON.stringify({ phase: 'threads' }));

    expect(coverage).toEqual({ resource: 'c1', status: 'partial', reason: 'channel:not_found' });
  });

  it('marks an unsupported channel type as failed', async () => {
    installRoutes([['/channels/c1', () => ({ statusCode: 200, body: { id: 'c1', type: 2, guild_id: 'g1' } })]]);

    const { coverage } = await collect('c1');

    expect(coverage).toEqual({ resource: 'c1', status: 'failed', reason: 'unsupported_resource' });
  });
});

describe('iterateRecords — resume', () => {
  it('resumes the message walk from the cursor instead of restarting', async () => {
    const calls = installRoutes([
      ['/channels/c1/messages', () => ({ statusCode: 200, body: [] })],
      ['/channels/c1/threads/archived/public', () => ({ statusCode: 200, body: { threads: [], has_more: false } })],
      ['/channels/c1', () => ({ statusCode: 200, body: textChannel })],
      ['/guilds/g1/threads/active', () => ({ statusCode: 200, body: { threads: [] } })],
    ]);

    await collect('c1', JSON.stringify({ phase: 'messages', before: '555' }));

    expect(calls.some((url) => url.includes('/channels/c1/messages?limit=100&before=555'))).toBe(true);
    expect(calls.some((url) => url.includes(`before=${END_SNOWFLAKE}`))).toBe(false);
  });

  it('resumes archived-thread pagination without re-walking messages or active threads', async () => {
    const calls = installRoutes([
      ['/channels/c1/threads/archived/public', () => ({ statusCode: 200, body: { threads: [], has_more: false } })],
      ['/channels/c1', () => ({ statusCode: 200, body: textChannel })],
    ]);

    const { coverage } = await collect(
      'c1',
      JSON.stringify({ phase: 'threads', archivedBefore: '2026-07-15T00:00:00.000Z' }),
    );

    expect(coverage.status).toBe('complete');
    expect(calls.some((url) => url.includes('/channels/c1/messages'))).toBe(false);
    expect(calls.some((url) => url.includes('/threads/active'))).toBe(false);
    expect(
      calls.some((url) =>
        url.includes(`archived/public?limit=100&before=${encodeURIComponent('2026-07-15T00:00:00.000Z')}`),
      ),
    ).toBe(true);
  });

  it('restarts cleanly on an unreadable cursor', async () => {
    const calls = installRoutes([
      ['/channels/c1/messages', () => ({ statusCode: 200, body: [] })],
      ['/channels/c1/threads/archived/public', () => ({ statusCode: 200, body: { threads: [], has_more: false } })],
      ['/channels/c1', () => ({ statusCode: 200, body: textChannel })],
      ['/guilds/g1/threads/active', () => ({ statusCode: 200, body: { threads: [] } })],
    ]);

    const { coverage } = await collect('c1', 'not-json');

    expect(coverage.status).toBe('complete');
    expect(calls.some((url) => url.includes(`before=${END_SNOWFLAKE}`))).toBe(true);
  });
});

describe('iterateRecords — transient failures', () => {
  it('propagates upstream errors so the whole fetch can retry from the checkpoint', async () => {
    installRoutes([['/channels/c1', () => ({ statusCode: 500, body: { message: 'boom' } })]]);

    await expect(collect('c1')).rejects.toBeInstanceOf(CommunityHttpError);
  });

  it('propagates an exhausted rate limit', async () => {
    installRoutes([['/channels/c1', () => ({ statusCode: 429, body: { retry_after: 0 } })]]);

    await expect(collect('c1')).rejects.toBeInstanceOf(CommunityRateLimitError);
  });
});

describe('iterateRecords — forum channels', () => {
  it('crawls posts as threads and never requests channel messages', async () => {
    const calls = installRoutes([
      [
        '/channels/c1/threads/archived/public',
        () => ({
          statusCode: 200,
          body: {
            threads: [
              {
                id: 'p2',
                type: 11,
                parent_id: 'c1',
                thread_metadata: { archive_timestamp: '2026-07-20T00:00:00.000Z' },
              },
            ],
            has_more: false,
          },
        }),
      ],
      ['/channels/c1', () => ({ statusCode: 200, body: { id: 'c1', type: 15, guild_id: 'g1' } })],
      [
        '/guilds/g1/threads/active',
        () => ({ statusCode: 200, body: { threads: [{ id: 'p1', type: 11, parent_id: 'c1' }] } }),
      ],
      ['/channels/p1/messages', () => ({ statusCode: 200, body: [msg('p1m', '2026-07-21T00:00:00.000Z')] })],
      ['/channels/p2/messages', () => ({ statusCode: 200, body: [msg('p2m', '2026-07-19T00:00:00.000Z')] })],
    ]);

    const { batches, coverage } = await collect('c1');

    expect(coverage.status).toBe('complete');
    expect(
      batches
        .flatMap((batch) => batch.records)
        .map((record) => record.objectId)
        .sort(),
    ).toEqual(['p1m', 'p2m']);
    expect(calls.some((url) => url.includes('/channels/c1/messages'))).toBe(false);
  });
});
