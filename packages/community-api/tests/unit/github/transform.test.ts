import { describe, expect, it } from 'vitest';
import {
  buildGitHubInstallUrl,
  hasRequiredIssueFields,
  isPullRequest,
  pullRequestNumber,
  toCommentRecords,
  toGitHubAccountProfile,
  toInstallation,
  toIssueRecords,
  toMatchedAccountId,
  toRepositoryResources,
  toReviewRecords,
} from '../../../src/github/transform.js';
import { CommunityContractError } from '../../../src/shared/errors.js';

const WINDOW = { start: '2026-06-01T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' };
const REPO = '4242';

const user = (id: number, type = 'User') => ({ id, login: `user-${id}`, type });

describe('buildGitHubInstallUrl', () => {
  it('points at the App install page and carries the signed state', () => {
    const url = new URL(buildGitHubInstallUrl({ slug: 'reputo-community', state: 'signed.state' }));

    expect(url.origin + url.pathname).toBe('https://github.com/apps/reputo-community/installations/new');
    expect(url.searchParams.get('state')).toBe('signed.state');
  });
});

describe('toInstallation', () => {
  it('reads the id and the account it belongs to', () => {
    expect(toInstallation({ id: 55, account: { login: 'singnet' } })).toEqual({ id: '55', account: 'singnet' });
  });

  it('falls back to the id when GitHub reports no account login', () => {
    expect(toInstallation({ id: 55, account: null })).toEqual({ id: '55', account: '55' });
  });

  it('rejects a response without an installation id', () => {
    expect(() => toInstallation({})).toThrow(CommunityContractError);
  });
});

describe('toRepositoryResources', () => {
  it('keys repositories by their stable id and labels them by full name', () => {
    const resources = toRepositoryResources([
      { id: 2, name: 'snet-b', full_name: 'singnet/snet-b' },
      { id: 1, name: 'snet-a', full_name: 'singnet/snet-a' },
      { id: 3, name: 'broken' },
    ]);

    expect(resources).toEqual([
      { id: '1', name: 'singnet/snet-a', kind: 'repository' },
      { id: '2', name: 'singnet/snet-b', kind: 'repository' },
    ]);
  });

  it('rejects a listing that is not an array', () => {
    expect(() => toRepositoryResources({ repositories: [] })).toThrow(CommunityContractError);
  });
});

describe('hasRequiredIssueFields', () => {
  it('accepts an empty page and a page carrying id and creation time', () => {
    expect(hasRequiredIssueFields([])).toBe(true);
    expect(hasRequiredIssueFields([{ id: 1, created_at: '2026-07-01T00:00:00Z' }])).toBe(true);
  });

  it('rejects a page missing the fields the crawl depends on', () => {
    expect(hasRequiredIssueFields([{ id: 1 }])).toBe(false);
  });
});

describe('issue and pull request mapping', () => {
  it('maps an issue to one issue_opened row at its creation time', () => {
    const records = toIssueRecords(
      { id: 10, number: 1, user: user(7), created_at: '2026-07-01T10:00:00Z' },
      REPO,
      WINDOW,
    );

    expect(records).toEqual([
      {
        type: 'issue_opened',
        actor: '7',
        counterparty: null,
        resource: REPO,
        objectId: '10',
        occurredAt: '2026-07-01T10:00:00.000Z',
        count: 1,
        actorIsBot: false,
        deleted: false,
      },
    ]);
  });

  it('maps a pull request opened and merged inside the window to both rows', () => {
    const records = toIssueRecords(
      {
        id: 11,
        number: 2,
        user: user(7),
        created_at: '2026-07-01T10:00:00Z',
        pull_request: { merged_at: '2026-07-05T09:00:00Z' },
      },
      REPO,
      WINDOW,
    );

    expect(records.map((record) => [record.type, record.occurredAt])).toEqual([
      ['pull_request_opened', '2026-07-01T10:00:00.000Z'],
      ['pull_request_merged', '2026-07-05T09:00:00.000Z'],
    ]);
  });

  /** The doc's rule: an old pull request merged inside the window counts by its merge time. */
  it('keeps only the merge row for a pull request opened before the window', () => {
    const records = toIssueRecords(
      {
        id: 12,
        number: 3,
        user: user(8),
        created_at: '2025-01-01T00:00:00Z',
        pull_request: { merged_at: '2026-07-05T09:00:00Z' },
      },
      REPO,
      WINDOW,
    );

    expect(records).toEqual([
      expect.objectContaining({ type: 'pull_request_merged', actor: '8', occurredAt: '2026-07-05T09:00:00.000Z' }),
    ]);
  });

  it('drops an unmerged pull request opened before the window', () => {
    expect(
      toIssueRecords(
        { id: 13, number: 4, user: user(8), created_at: '2025-01-01T00:00:00Z', pull_request: { merged_at: null } },
        REPO,
        WINDOW,
      ),
    ).toEqual([]);
  });

  it('flags bot authors instead of dropping them', () => {
    const [record] = toIssueRecords(
      { id: 14, number: 5, user: user(9, 'Bot'), created_at: '2026-07-01T10:00:00Z' },
      REPO,
      WINDOW,
    );

    expect(record.actorIsBot).toBe(true);
  });

  it('emits nothing for a deleted account or a row without an id', () => {
    expect(toIssueRecords({ id: 15, number: 6, user: null, created_at: '2026-07-01T10:00:00Z' }, REPO, WINDOW)).toEqual(
      [],
    );
    expect(toIssueRecords({ number: 6, user: user(7), created_at: '2026-07-01T10:00:00Z' }, REPO, WINDOW)).toEqual([]);
  });

  it('separates pull requests from issues by the pull_request marker', () => {
    expect(isPullRequest({ id: 1, pull_request: { merged_at: null } })).toBe(true);
    expect(isPullRequest({ id: 1 })).toBe(false);
    expect(pullRequestNumber({ id: 1, number: 9, pull_request: {} })).toBe(9);
    expect(pullRequestNumber({ id: 1, number: 9 })).toBeUndefined();
  });
});

describe('toReviewRecords', () => {
  it('credits reviewers at submission time with the pull request author as counterparty', () => {
    const records = toReviewRecords(
      [
        { id: 21, user: user(3), state: 'APPROVED', submitted_at: '2026-07-02T08:00:00Z' },
        { id: 22, user: user(4), state: 'PENDING' },
        { id: 23, user: user(5), state: 'COMMENTED', submitted_at: '2025-01-01T00:00:00Z' },
      ],
      REPO,
      WINDOW,
      '7',
    );

    expect(records).toEqual([
      expect.objectContaining({
        type: 'pull_request_review',
        actor: '3',
        counterparty: '7',
        objectId: '21',
        occurredAt: '2026-07-02T08:00:00.000Z',
      }),
    ]);
  });

  it('tolerates a listing that is not an array', () => {
    expect(toReviewRecords(undefined, REPO, WINDOW, null)).toEqual([]);
  });
});

describe('toCommentRecords', () => {
  it('keeps comments created inside the window and drops ones only edited inside it', () => {
    const records = toCommentRecords(
      [
        { id: 31, user: user(3), created_at: '2026-07-03T08:00:00Z' },
        { id: 32, user: user(4), created_at: '2025-12-01T08:00:00Z' },
        { id: 33, user: null, created_at: '2026-07-03T08:00:00Z' },
      ],
      REPO,
      WINDOW,
    );

    expect(records).toEqual([
      expect.objectContaining({ type: 'comment', actor: '3', objectId: '31', counterparty: null }),
    ]);
  });
});

describe('toMatchedAccountId', () => {
  it('resolves only an exact login match', () => {
    expect(toMatchedAccountId({ id: 7, login: 'octocat' }, 'octocat')).toBe('7');
    expect(toMatchedAccountId({ id: 7, login: 'Octocat' }, 'octocat')).toBeNull();
    expect(toMatchedAccountId(undefined, 'octocat')).toBeNull();
  });
});

describe('toGitHubAccountProfile', () => {
  it('passes the account avatar through', () => {
    expect(toGitHubAccountProfile({ id: 55, account: { login: 'singnet', avatar_url: 'https://a.test/u/1' } })).toEqual(
      { avatarUrl: 'https://a.test/u/1' },
    );
  });

  it('leaves an absent or malformed avatar undefined', () => {
    expect(toGitHubAccountProfile({ id: 55, account: { login: 'singnet' } }).avatarUrl).toBeUndefined();
    expect(toGitHubAccountProfile({ id: 55, account: { avatar_url: '' } }).avatarUrl).toBeUndefined();
    expect(toGitHubAccountProfile({ id: 55, account: null }).avatarUrl).toBeUndefined();
  });
});
