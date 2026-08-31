import { createVerify } from 'node:crypto';
import { request } from 'undici';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppJwt, createGitHubApi } from '../../../src/github/auth.js';
import { CommunityRateLimitError } from '../../../src/shared/errors.js';
import {
  INSTALLATION_TOKEN_BODY,
  rateLimitHeaders,
  TEST_APP_KEYS,
  TEST_GITHUB_APP,
} from '../../utils/github-helpers.js';
import { createStubLogger, mockUndiciResponse } from '../../utils/mock-helpers.js';

vi.mock('undici', () => ({ request: vi.fn() }));

const mockRequest = vi.mocked(request);
const logger = createStubLogger();

const decodeSegment = (segment: string) => JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
const calls = () => mockRequest.mock.calls as unknown as Array<[string, { headers: Record<string, string> }]>;

describe('createAppJwt', () => {
  it('signs an RS256 token the App public key verifies', () => {
    const jwt = createAppJwt(TEST_GITHUB_APP, Date.parse('2026-08-01T00:00:00.000Z'));
    const [header, payload, signature] = jwt.split('.');

    expect(decodeSegment(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(
      createVerify('RSA-SHA256')
        .update(`${header}.${payload}`)
        .end()
        .verify(TEST_APP_KEYS.publicKey, Buffer.from(signature, 'base64url')),
    ).toBe(true);
  });

  it('issues the App as the subject, backdated and inside the ten-minute cap', () => {
    const nowSeconds = Math.floor(Date.parse('2026-08-01T00:00:00.000Z') / 1000);
    const claims = decodeSegment(createAppJwt(TEST_GITHUB_APP, nowSeconds * 1000).split('.')[1]);

    expect(claims.iss).toBe(TEST_GITHUB_APP.appId);
    expect(claims.iat).toBeLessThan(nowSeconds);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
  });

  it('reports an unusable private key without echoing the key material', () => {
    expect(() => createAppJwt({ appId: '1', privateKey: 'not-a-key' })).toThrow(/not a usable RSA key/);
  });
});

describe('createGitHubApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mints one installation token and reuses it for later calls', async () => {
    mockRequest
      .mockResolvedValueOnce(mockUndiciResponse(201, INSTALLATION_TOKEN_BODY) as never)
      .mockResolvedValue(mockUndiciResponse(200, [], rateLimitHeaders(11_000)) as never);

    const api = createGitHubApi(TEST_GITHUB_APP, logger);
    await api.installationRequest('55', 'GET', '/installation/repositories');
    await api.installationRequest('55', 'GET', '/repos/singnet/snet/issues');

    const [tokenCall, firstRead, secondRead] = calls();
    expect(tokenCall[0]).toBe('https://api.github.com/app/installations/55/access_tokens');
    expect(tokenCall[1].headers.authorization).toMatch(/^Bearer /);
    expect(firstRead[1].headers.authorization).toBe(`token ${INSTALLATION_TOKEN_BODY.token}`);
    expect(secondRead[1].headers.authorization).toBe(`token ${INSTALLATION_TOKEN_BODY.token}`);
    expect(mockRequest).toHaveBeenCalledTimes(3);
  });

  it('mints a fresh token once when the current one is rejected', async () => {
    mockRequest
      .mockResolvedValueOnce(mockUndiciResponse(201, INSTALLATION_TOKEN_BODY) as never)
      .mockResolvedValueOnce(mockUndiciResponse(401, { message: 'Bad credentials' }) as never)
      .mockResolvedValueOnce(mockUndiciResponse(201, { ...INSTALLATION_TOKEN_BODY, token: 'ghs_rotated' }) as never)
      .mockResolvedValueOnce(mockUndiciResponse(200, [{ id: 1 }], rateLimitHeaders(11_000)) as never);

    const api = createGitHubApi(TEST_GITHUB_APP, logger);

    await expect(api.installationRequest('55', 'GET', '/installation/repositories')).resolves.toEqual([{ id: 1 }]);
    expect(calls().at(-1)?.[1].headers.authorization).toBe('token ghs_rotated');
  });

  it('reports the installation budget and refuses to spend requests once it is gone', async () => {
    mockRequest
      .mockResolvedValueOnce(mockUndiciResponse(201, INSTALLATION_TOKEN_BODY) as never)
      .mockResolvedValueOnce(mockUndiciResponse(200, [], rateLimitHeaders(0)) as never);

    const api = createGitHubApi(TEST_GITHUB_APP, logger);
    await api.installationRequest('55', 'GET', '/installation/repositories');

    expect(api.rateLimit()).toMatchObject({ limit: 12_500, remaining: 0 });
    await expect(api.installationRequest('55', 'GET', '/repos/singnet/snet/issues')).rejects.toBeInstanceOf(
      CommunityRateLimitError,
    );
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('keeps the App budget out of the installation snapshot', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(200, { id: 55 }, rateLimitHeaders(0, 15_000)) as never);

    const api = createGitHubApi(TEST_GITHUB_APP, logger);
    await api.appRequest('GET', '/app/installations/55');

    expect(api.rateLimit()).toBeUndefined();
  });
});
