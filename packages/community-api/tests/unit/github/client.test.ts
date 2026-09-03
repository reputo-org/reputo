import { request } from 'undici';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitHubClient } from '../../../src/github/client.js';
import { CommunityAuthError, CommunityPermissionError } from '../../../src/shared/errors.js';
import { INSTALLATION_TOKEN_BODY, rateLimitHeaders, TEST_GITHUB_CLIENT_CONFIG } from '../../utils/github-helpers.js';
import { createStubLogger, mockUndiciResponse } from '../../utils/mock-helpers.js';

vi.mock('undici', () => ({ request: vi.fn() }));

const mockRequest = vi.mocked(request);
/** A fresh client per test: installation tokens are cached for a client's lifetime. */
const newClient = () => createGitHubClient(TEST_GITHUB_CLIENT_CONFIG, createStubLogger());

const REPOSITORIES = {
  repositories: [{ id: 1, name: 'snet', full_name: 'singnet/snet' }],
};

const lastCall = () => mockRequest.mock.calls.at(-1) as [string, { method: string; headers: Record<string, string> }];

describe('buildInstallUrl', () => {
  it('sends the admin to the App install page with the signed state', () => {
    expect(newClient().buildInstallUrl('signed.state')).toBe(
      'https://github.com/apps/reputo-community/installations/new?state=signed.state',
    );
  });
});

describe('confirmInstallation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('confirms the callback id with the app JWT and returns the account', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(200, { id: 55, account: { login: 'singnet' } }) as never);

    await expect(newClient().confirmInstallation('55')).resolves.toEqual({ id: '55', account: 'singnet' });

    const [url, options] = lastCall();
    expect(url).toBe('https://api.github.com/app/installations/55');
    expect(options.headers.authorization).toMatch(/^Bearer /);
  });

  it('rejects an installation this App does not own', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(404, { message: 'Not Found' }) as never);

    await expect(newClient().confirmInstallation('forged')).rejects.toBeInstanceOf(CommunityAuthError);
  });
});

describe('listResources and probe', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the installation repositories with an installation token', async () => {
    mockRequest
      .mockResolvedValueOnce(mockUndiciResponse(201, INSTALLATION_TOKEN_BODY) as never)
      .mockResolvedValueOnce(mockUndiciResponse(200, REPOSITORIES, rateLimitHeaders(11_000)) as never);

    await expect(newClient().listResources('55')).resolves.toEqual([
      { id: '1', name: 'singnet/snet', kind: 'repository', readable: true },
    ]);
    expect(lastCall()[1].headers.authorization).toBe(`token ${INSTALLATION_TOKEN_BODY.token}`);
  });

  const INSTALLATION = {
    id: 55,
    account: { login: 'singnet', avatar_url: 'https://avatars.githubusercontent.com/u/6000104' },
    permissions: { issues: 'read', pull_requests: 'read', metadata: 'read' },
    suspended_at: null,
  };
  const ISSUES_PAGE = [{ id: 10, created_at: '2026-07-01T00:00:00Z' }];

  it('confirms the installation, then reads one issues page to prove the granted permissions', async () => {
    mockRequest
      .mockResolvedValueOnce(mockUndiciResponse(200, INSTALLATION) as never)
      .mockResolvedValueOnce(mockUndiciResponse(201, INSTALLATION_TOKEN_BODY) as never)
      .mockResolvedValueOnce(mockUndiciResponse(200, REPOSITORIES, rateLimitHeaders(11_000)) as never)
      .mockResolvedValueOnce(mockUndiciResponse(200, ISSUES_PAGE, rateLimitHeaders(10_999)) as never);

    await expect(newClient().probe('55')).resolves.toEqual({
      resourceCount: 1,
      readableResourceCount: 1,
      resourcesDigest: expect.stringMatching(/^[0-9a-f]{16}$/),
      sampledResourceId: '1',
      sampledRecordCount: 1,
      profile: { avatarUrl: 'https://avatars.githubusercontent.com/u/6000104' },
    });
    expect(mockRequest.mock.calls[0]?.[0]).toBe('https://api.github.com/app/installations/55');
    expect(lastCall()[0]).toContain('/repos/singnet/snet/issues');
  });

  it('fails the probe when GitHub no longer reports the installation', async () => {
    mockRequest.mockResolvedValueOnce(mockUndiciResponse(404, { message: 'Not Found' }) as never);

    await expect(newClient().probe('55')).rejects.toMatchObject({ statusCode: 404, category: 'not_found' });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('refuses a suspended installation before touching any repository', async () => {
    mockRequest.mockResolvedValueOnce(
      mockUndiciResponse(200, { ...INSTALLATION, suspended_at: '2026-08-30T10:00:00Z' }) as never,
    );

    await expect(newClient().probe('55')).rejects.toBeInstanceOf(CommunityAuthError);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('refuses an installation whose accepted permissions no longer cover the crawl', async () => {
    mockRequest.mockResolvedValueOnce(
      mockUndiciResponse(200, { ...INSTALLATION, permissions: { metadata: 'read', contents: 'read' } }) as never,
    );

    await expect(newClient().probe('55')).rejects.toThrow(/issues, pull_requests/);
  });

  it('fails the probe when no repository can be read', async () => {
    mockRequest
      .mockResolvedValueOnce(mockUndiciResponse(200, INSTALLATION) as never)
      .mockResolvedValueOnce(mockUndiciResponse(201, INSTALLATION_TOKEN_BODY) as never)
      .mockResolvedValueOnce(mockUndiciResponse(200, REPOSITORIES, rateLimitHeaders(11_000)) as never)
      .mockResolvedValue(mockUndiciResponse(403, { message: 'Resource not accessible' }) as never);

    await expect(newClient().probe('55')).rejects.toBeInstanceOf(CommunityPermissionError);
  });

  it('lists a repository with issues disabled as unreadable and probes past it', async () => {
    mockRequest
      .mockResolvedValueOnce(mockUndiciResponse(200, INSTALLATION) as never)
      .mockResolvedValueOnce(mockUndiciResponse(201, INSTALLATION_TOKEN_BODY) as never)
      .mockResolvedValueOnce(
        mockUndiciResponse(
          200,
          {
            repositories: [
              { id: 9, name: 'archived', full_name: 'singnet/archived', has_issues: false },
              { id: 1, name: 'snet', full_name: 'singnet/snet', has_issues: true },
            ],
          },
          rateLimitHeaders(11_000),
        ) as never,
      )
      .mockResolvedValueOnce(mockUndiciResponse(200, ISSUES_PAGE, rateLimitHeaders(10_999)) as never);

    // The tracker-less repository sorts first but is never read.
    await expect(newClient().probe('55')).resolves.toMatchObject({
      resourceCount: 2,
      readableResourceCount: 1,
      sampledResourceId: '1',
    });
    expect(lastCall()[0]).toContain('/repos/singnet/snet/issues');
  });

  it('reports an installation whose repositories all have issues disabled', async () => {
    mockRequest
      .mockResolvedValueOnce(mockUndiciResponse(200, INSTALLATION) as never)
      .mockResolvedValueOnce(mockUndiciResponse(201, INSTALLATION_TOKEN_BODY) as never)
      .mockResolvedValueOnce(
        mockUndiciResponse(
          200,
          { repositories: [{ id: 9, name: 'archived', full_name: 'singnet/archived', has_issues: false }] },
          rateLimitHeaders(11_000),
        ) as never,
      );

    await expect(newClient().probe('55')).rejects.toThrow(/issue tracker enabled/);
  });

  it('fails the probe when the installation grants no repository', async () => {
    mockRequest
      .mockResolvedValueOnce(mockUndiciResponse(200, INSTALLATION) as never)
      .mockResolvedValueOnce(mockUndiciResponse(201, INSTALLATION_TOKEN_BODY) as never)
      .mockResolvedValueOnce(mockUndiciResponse(200, { repositories: [] }, rateLimitHeaders(11_000)) as never);

    await expect(newClient().probe('55')).rejects.toThrow(/no repositories/);
  });
});

describe('deleteInstallation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uninstalls the App with the app JWT', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(204, '') as never);

    await newClient().deleteInstallation('55');

    const [url, options] = lastCall();
    expect(url).toBe('https://api.github.com/app/installations/55');
    expect(options.method).toBe('DELETE');
  });

  it('treats an already-removed installation as removed', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(404, { message: 'Not Found' }) as never);

    await expect(newClient().deleteInstallation('55')).resolves.toBeUndefined();
  });
});
