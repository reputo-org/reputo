import { request } from 'undici';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenManager } from '../../../src/api/token.js';
import { createStubLogger, mockUndiciResponse, TEST_CONFIG } from '../../utils/mock-helpers.js';

vi.mock('undici', () => ({ request: vi.fn() }));

const mockRequest = vi.mocked(request);
const logger = createStubLogger();

function tokenResponse(accessToken: string, expiresIn = 3600) {
  return mockUndiciResponse(200, {
    access_token: accessToken,
    expires_in: expiresIn,
    scope: TEST_CONFIG.scopes,
    token_type: 'bearer',
  });
}

describe('createTokenManager', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches once and caches while fresh', async () => {
    mockRequest.mockResolvedValue(tokenResponse('tok-1') as never);
    const manager = createTokenManager(TEST_CONFIG, logger);

    expect(await manager.getToken()).toBe('tok-1');
    expect(await manager.getToken()).toBe('tok-1');
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('sends Basic auth and the client_credentials grant to the identity host', async () => {
    mockRequest.mockResolvedValue(tokenResponse('tok-1') as never);
    const manager = createTokenManager(TEST_CONFIG, logger);

    await manager.getToken();

    const [url, options] = mockRequest.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://identity.test.deep-id.ai/oauth2/token');
    const expectedBasic = Buffer.from('test-client:test-secret').toString('base64');
    expect(options.headers.Authorization).toBe(`Basic ${expectedBasic}`);
    expect(options.body).toContain('grant_type=client_credentials');
    expect(options.body).toContain('scope=api+wallets+post_scores');
  });

  it('re-fetches when the cached token is within the refresh skew of expiry', async () => {
    // expires_in (10s) < tokenRefreshSkewMs (60s) → never considered fresh.
    mockRequest
      .mockResolvedValueOnce(tokenResponse('tok-1', 10) as never)
      .mockResolvedValueOnce(tokenResponse('tok-2', 10) as never);
    const manager = createTokenManager(TEST_CONFIG, logger);

    expect(await manager.getToken()).toBe('tok-1');
    expect(await manager.getToken()).toBe('tok-2');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('forceRefresh discards the cache', async () => {
    mockRequest
      .mockResolvedValueOnce(tokenResponse('tok-1') as never)
      .mockResolvedValueOnce(tokenResponse('tok-2') as never);
    const manager = createTokenManager(TEST_CONFIG, logger);

    expect(await manager.getToken()).toBe('tok-1');
    expect(await manager.getToken(true)).toBe('tok-2');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('coalesces concurrent fetches into a single request (single-flight)', async () => {
    mockRequest.mockResolvedValue(tokenResponse('tok-1') as never);
    const manager = createTokenManager(TEST_CONFIG, logger);

    const [a, b] = await Promise.all([manager.getToken(), manager.getToken()]);

    expect(a).toBe('tok-1');
    expect(b).toBe('tok-1');
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});
