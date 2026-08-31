import { request } from 'undici';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitHubAdapter } from '../../../src/github/adapter.js';
import type { CommunityRecordBatch, CommunityResourceCoverage } from '../../../src/shared/records.js';
import { INSTALLATION_TOKEN_BODY, rateLimitHeaders, TEST_GITHUB_ADAPTER_CONFIG } from '../../utils/github-helpers.js';
import { createStubLogger, mockUndiciResponse } from '../../utils/mock-helpers.js';

vi.mock('undici', () => ({ request: vi.fn() }));

const mockRequest = vi.mocked(request);
const WINDOW = { start: '2026-06-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' };

const REPOSITORIES = {
  repositories: [
    { id: 1, name: 'snet', full_name: 'singnet/snet' },
    { id: 2, name: 'locked', full_name: 'singnet/locked' },
  ],
};

const issue = (id: number, createdAt: string, userId = 7) => ({
  id,
  number: id,
  user: { id: userId, login: `user-${userId}`, type: 'User' },
  created_at: createdAt,
});

const pull = (id: number, createdAt: string, mergedAt: string | null, userId = 7) => ({
  ...issue(id, createdAt, userId),
  pull_request: { merged_at: mergedAt },
});

type Responder = (url: string) => { statusCode: number; body: unknown };

/** Routes every mocked call by URL substring; unrouted calls fail the test loudly. */
function installRoutes(routes: Array<[string, Responder]>): string[] {
  const calls: string[] = [];
  mockRequest.mockImplementation(async (rawUrl) => {
    const url = String(rawUrl);
    calls.push(url);
    if (url.includes('/access_tokens')) {
      return mockUndiciResponse(201, INSTALLATION_TOKEN_BODY) as never;
    }
    for (const [needle, respond] of routes) {
      if (url.includes(needle)) {
        const { statusCode, body } = respond(url);
        return mockUndiciResponse(statusCode, body, rateLimitHeaders(11_000)) as never;
      }
    }
    throw new Error(`unrouted request: ${url}`);
  });
  return calls;
}

const emptyListings: Array<[string, Responder]> = [
  ['/installation/repositories', () => ({ statusCode: 200, body: REPOSITORIES })],
  ['/issues/comments', () => ({ statusCode: 200, body: [] })],
  ['/pulls/comments', () => ({ statusCode: 200, body: [] })],
];

async function collect(resourceId: string, cursor?: string) {
  const adapter = createGitHubAdapter(TEST_GITHUB_ADAPTER_CONFIG, createStubLogger());
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

describe('github record iteration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('crawls issues, reviews, and both comment listings of one repository', async () => {
    const calls = installRoutes([
      ['/installation/repositories', () => ({ statusCode: 200, body: REPOSITORIES })],
      [
        '/repos/singnet/snet/issues?',
        () => ({
          statusCode: 200,
          body: [issue(10, '2026-07-01T10:00:00Z'), pull(11, '2025-01-01T00:00:00Z', '2026-07-05T09:00:00Z', 8)],
        }),
      ],
      [
        '/pulls/11/reviews',
        () => ({
          statusCode: 200,
          body: [{ id: 21, user: { id: 9, type: 'User' }, state: 'APPROVED', submitted_at: '2026-07-06T09:00:00Z' }],
        }),
      ],
      [
        '/issues/comments',
        () => ({
          statusCode: 200,
          body: [{ id: 31, user: { id: 7, type: 'User' }, created_at: '2026-07-07T09:00:00Z' }],
        }),
      ],
      [
        '/pulls/comments',
        () => ({
          statusCode: 200,
          body: [{ id: 32, user: { id: 'x' }, created_at: '2026-07-08T09:00:00Z' }],
        }),
      ],
    ]);

    const { batches, coverage } = await collect('1');
    const records = batches.flatMap((batch) => batch.records);

    expect(coverage).toEqual({ resource: '1', status: 'complete' });
    expect(records.map((record) => [record.type, record.actor, record.objectId])).toEqual([
      ['issue_opened', '7', '10'],
      ['pull_request_merged', '8', '11'],
      ['pull_request_review', '9', '21'],
      ['comment', '7', '31'],
    ]);

    // One reviews call per pull request, and none for a plain issue.
    expect(calls.filter((url) => url.includes('/reviews'))).toHaveLength(1);
    // The issues listing walks oldest-update-first from the window start so an
    // old pull request merged inside the window is still found.
    const issuesUrl = new URL(calls.find((url) => url.includes('/snet/issues?')) as string);
    expect(Object.fromEntries(issuesUrl.searchParams)).toMatchObject({
      state: 'all',
      sort: 'updated',
      direction: 'asc',
      since: WINDOW.start,
      per_page: '100',
      page: '1',
    });
  });

  it('follows pagination and resumes a phase from its cursor without rewalking earlier pages', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => issue(1000 + index, '2026-07-01T10:00:00Z'));
    installRoutes([
      ...emptyListings,
      [
        '/repos/singnet/snet/issues?',
        (url) => ({
          statusCode: 200,
          body: new URL(url).searchParams.get('page') === '1' ? firstPage : [issue(2000, '2026-07-02T10:00:00Z')],
        }),
      ],
    ]);

    const { batches } = await collect('1');

    expect(batches[0].records).toHaveLength(100);
    expect(JSON.parse(batches[0].cursor)).toEqual({ phase: 'issues', page: 2 });
    expect(batches[1].records.map((record) => record.objectId)).toEqual(['2000']);

    const calls = installRoutes([
      ...emptyListings,
      ['/repos/singnet/snet/issues?', () => ({ statusCode: 200, body: [issue(2000, '2026-07-02T10:00:00Z')] })],
    ]);
    const resumed = await collect('1', JSON.stringify({ phase: 'issues', page: 2 }));

    expect(resumed.coverage.status).toBe('complete');
    const issuePages = calls
      .filter((url) => url.includes('/snet/issues?'))
      .map((url) => new URL(url).searchParams.get('page'));
    expect(issuePages).toEqual(['2']);
  });

  it('records an unreadable repository as failed coverage', async () => {
    installRoutes([
      ...emptyListings,
      ['/repos/singnet/locked/issues', () => ({ statusCode: 403, body: { message: 'Resource not accessible' } })],
    ]);

    expect(await collect('2')).toMatchObject({
      coverage: { resource: '2', status: 'failed', reason: 'permission_denied' },
    });
  });

  it('records a repository with issues disabled instead of failing the whole fetch', async () => {
    installRoutes([
      ...emptyListings,
      ['/repos/singnet/locked/issues', () => ({ statusCode: 410, body: { message: 'Issues are disabled' } })],
    ]);

    expect(await collect('2')).toMatchObject({ coverage: { status: 'failed', reason: 'upstream_error' } });
  });

  it('downgrades a later failure to partial once pages have been read', async () => {
    installRoutes([
      ['/installation/repositories', () => ({ statusCode: 200, body: REPOSITORIES })],
      ['/repos/singnet/snet/issues?', () => ({ statusCode: 200, body: [issue(10, '2026-07-01T10:00:00Z')] })],
      ['/issues/comments', () => ({ statusCode: 404, body: { message: 'Not Found' } })],
      ['/pulls/comments', () => ({ statusCode: 200, body: [] })],
    ]);

    const { coverage } = await collect('1');

    expect(coverage).toEqual({ resource: '1', status: 'partial', reason: 'issue_comments:not_found' });
  });

  it('fails a repository the installation no longer carries', async () => {
    installRoutes(emptyListings);

    expect(await collect('999')).toMatchObject({
      coverage: { resource: '999', status: 'failed', reason: 'not_found' },
    });
  });

  it('lets a connection-wide failure escape so the whole fetch retries', async () => {
    installRoutes([
      ['/installation/repositories', () => ({ statusCode: 200, body: REPOSITORIES })],
      ['/repos/singnet/snet/issues?', () => ({ statusCode: 500, body: { message: 'server error' } })],
    ]);

    await expect(collect('1')).rejects.toThrow(/HTTP 500/);
  });
});
