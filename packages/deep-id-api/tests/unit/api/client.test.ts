import { request } from 'undici';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeepIdClient } from '../../../src/api/client.js';
import { mockUndiciResponse } from '../../utils/mock-helpers.js';

vi.mock('undici', () => ({ request: vi.fn() }));

const mockRequest = vi.mocked(request);

function createClient() {
  return createDeepIdClient({
    identityBaseUrl: 'https://identity.test.deep-id.ai',
    appBaseUrl: 'https://app.test.deep-id.ai',
    clientId: 'test-client',
    clientSecret: 'test-secret',
    retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
    tokenRefreshSkewMs: 60_000,
    logLevel: 'silent',
  });
}

const TOKEN_OK = mockUndiciResponse(200, {
  access_token: 'tok-1',
  expires_in: 3600,
  scope: 'api wallets post_scores',
  token_type: 'bearer',
});

function isTokenUrl(url: unknown): boolean {
  return String(url).includes('/oauth2/token');
}

describe('createDeepIdClient', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('getUsers', () => {
    it('walks pages via the x-next header and merges them', async () => {
      const page1 = mockUndiciResponse(
        200,
        { 'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa': { scopes: ['api', 'wallets'], wallets: [] } },
        { 'x-next': 'cursor-2' },
      );
      const page2 = mockUndiciResponse(200, {
        'did:sub:bbbbbbbbbbbbbbbbbbbbbbbb': { scopes: ['api'] },
      });

      let usersCall = 0;
      mockRequest.mockImplementation((url) => {
        if (isTokenUrl(url)) return Promise.resolve(TOKEN_OK as never);
        usersCall += 1;
        return Promise.resolve((usersCall === 1 ? page1 : page2) as never);
      });

      const users = await createClient().getUsers();

      expect(Object.keys(users)).toEqual(['did:sub:aaaaaaaaaaaaaaaaaaaaaaaa', 'did:sub:bbbbbbbbbbbbbbbbbbbbbbbb']);
      expect(usersCall).toBe(2);
    });

    it('passes pageSize and the next cursor as query params', async () => {
      mockRequest.mockImplementation((url) => {
        if (isTokenUrl(url)) return Promise.resolve(TOKEN_OK as never);
        return Promise.resolve(mockUndiciResponse(200, {}) as never);
      });

      await createClient().getUsers({ pageSize: 100 });

      const usersUrl = mockRequest.mock.calls.map((c) => String(c[0])).find((u) => u.includes('/v1/users'));
      expect(usersUrl).toContain('pageSize=100');
    });
  });

  describe('postScores', () => {
    it('posts the score map and returns the result', async () => {
      const apiResponse = {
        status: { ok: 1, failed: 0 },
        results: { 'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa': { message: 'OK' } },
      };
      mockRequest.mockImplementation((url) => {
        if (isTokenUrl(url)) return Promise.resolve(TOKEN_OK as never);
        return Promise.resolve(mockUndiciResponse(200, apiResponse) as never);
      });

      const result = await createClient().postScores({
        'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa': { score: 82, type: 'voting_engagement', timestamp: '2026-06-12T10:00:00Z' },
      });

      expect(result.status).toEqual({ ok: 1, failed: 0 });
      const postCall = mockRequest.mock.calls.find((c) => String(c[0]).includes('/v1/clients/scores'));
      expect(postCall?.[1]).toMatchObject({ method: 'POST' });
      expect(String((postCall?.[1] as { body: string }).body)).toContain('voting_engagement');
    });
  });

  describe('401 handling', () => {
    it('refreshes the token and retries once on a 401', async () => {
      let usersCall = 0;
      mockRequest.mockImplementation((url) => {
        if (isTokenUrl(url)) return Promise.resolve(TOKEN_OK as never);
        usersCall += 1;
        if (usersCall === 1) return Promise.resolve(mockUndiciResponse(401, 'unauthorized') as never);
        return Promise.resolve(mockUndiciResponse(200, {}) as never);
      });

      await createClient().getUsers();

      const tokenCalls = mockRequest.mock.calls.filter((c) => isTokenUrl(c[0])).length;
      expect(tokenCalls).toBe(2);
      expect(usersCall).toBe(2);
    });
  });
});
