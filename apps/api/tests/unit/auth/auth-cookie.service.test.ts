import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthCookieService } from '../../../src/auth/auth-cookie.service';
import { AUTH_FLOW_COOKIE_SUFFIX } from '../../../src/shared/constants';
import type { AuthFlowState } from '../../../src/shared/types';

const COOKIE_NAME = 'reputo_auth_session';
const FLOW_COOKIE_NAME = `${COOKIE_NAME}${AUTH_FLOW_COOKIE_SUFFIX}`;
const ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';

function createConfigService(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    'auth.cookieName': COOKIE_NAME,
    'auth.tokenEncryptionKey': ENCRYPTION_KEY,
    'auth.cookieSecure': true,
    'auth.cookieSameSite': 'lax',
    'auth.cookieDomain': undefined,
  };

  return {
    get: vi.fn((key: string) => overrides[key] ?? defaults[key]),
  } as unknown as ConfigService;
}

function createMockResponse() {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  } as any;
}

describe('AuthCookieService', () => {
  let service: AuthCookieService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AuthCookieService(createConfigService());
  });

  describe('getSessionId', () => {
    it('extracts the session ID from the cookie header', () => {
      const request = {
        headers: { cookie: `${COOKIE_NAME}=session-abc; other=value` },
      } as any;

      expect(service.getSessionId(request)).toBe('session-abc');
    });

    it('returns undefined when the cookie header is missing', () => {
      const request = { headers: {} } as any;

      expect(service.getSessionId(request)).toBeUndefined();
    });

    it('returns undefined when the cookie header does not contain the session cookie', () => {
      const request = {
        headers: { cookie: 'other=value; another=123' },
      } as any;

      expect(service.getSessionId(request)).toBeUndefined();
    });

    it('handles URI-encoded cookie names', () => {
      const request = {
        headers: { cookie: `${encodeURIComponent(COOKIE_NAME)}=encoded-session` },
      } as any;

      expect(service.getSessionId(request)).toBe('encoded-session');
    });
  });

  describe('setSessionCookie', () => {
    it('sets the session cookie with correct options', () => {
      const response = createMockResponse();
      const expiresAt = new Date('2026-05-01T00:00:00.000Z');

      service.setSessionCookie(response, 'session-123', expiresAt);

      expect(response.cookie).toHaveBeenCalledWith(COOKIE_NAME, 'session-123', {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        domain: undefined,
        path: '/',
        expires: expiresAt,
      });
    });
  });

  describe('clearSessionCookie', () => {
    it('clears the session cookie with the base cookie options', () => {
      const response = createMockResponse();

      service.clearSessionCookie(response);

      expect(response.clearCookie).toHaveBeenCalledWith(COOKIE_NAME, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        domain: undefined,
        path: '/',
      });
    });
  });

  describe('setAuthFlowCookie / getAuthFlow roundtrip', () => {
    it('encrypts the auth flow state and writes it as a cookie', () => {
      const response = createMockResponse();
      const authFlow: AuthFlowState = {
        provider: 'deep-id',
        state: 'state-xyz',
        codeVerifier: 'verifier-xyz',
      };

      service.setAuthFlowCookie(response, authFlow);

      expect(response.cookie).toHaveBeenCalledTimes(1);
      const [cookieName, cookieValue, options] = response.cookie.mock.calls[0];

      expect(cookieName).toBe(FLOW_COOKIE_NAME);
      expect(cookieValue).not.toContain('state-xyz');
      expect(cookieValue).toMatch(/^enc:v1:/);
      expect(options.maxAge).toBe(10 * 60 * 1000);
      expect(options.httpOnly).toBe(true);
    });

    it('decrypts the auth flow state from the cookie header', () => {
      const response = createMockResponse();
      const authFlow: AuthFlowState = {
        provider: 'deep-id',
        state: 'state-abc',
        codeVerifier: 'verifier-abc',
      };

      service.setAuthFlowCookie(response, authFlow);

      const encryptedValue = response.cookie.mock.calls[0][1];
      const request = {
        headers: { cookie: `${FLOW_COOKIE_NAME}=${encryptedValue}` },
      } as any;

      const result = service.getAuthFlow(request);

      expect(result).toEqual(authFlow);
    });
  });

  describe('getAuthFlow', () => {
    it('returns null when the flow cookie is missing', () => {
      const request = { headers: {} } as any;

      expect(service.getAuthFlow(request)).toBeNull();
    });

    it('returns null when the flow cookie has invalid encrypted content', () => {
      const request = {
        headers: { cookie: `${FLOW_COOKIE_NAME}=invalid-gibberish` },
      } as any;

      expect(service.getAuthFlow(request)).toBeNull();
    });

    it('returns null when the flow cookie was encrypted with a different key', () => {
      const otherService = new AuthCookieService(
        createConfigService({ 'auth.tokenEncryptionKey': 'different-key-at-least-32-chars!!' }),
      );
      const response = createMockResponse();
      otherService.setAuthFlowCookie(response, { provider: 'deep-id', state: 's', codeVerifier: 'v' });

      const encryptedValue = response.cookie.mock.calls[0][1];
      const request = {
        headers: { cookie: `${FLOW_COOKIE_NAME}=${encryptedValue}` },
      } as any;

      expect(service.getAuthFlow(request)).toBeNull();
    });
  });

  describe('clearAuthFlowCookie', () => {
    it('clears the flow cookie', () => {
      const response = createMockResponse();

      service.clearAuthFlowCookie(response);

      expect(response.clearCookie).toHaveBeenCalledWith(FLOW_COOKIE_NAME, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        domain: undefined,
        path: '/',
      });
    });
  });

  describe('cookie domain configuration', () => {
    it('includes the domain when configured', () => {
      service = new AuthCookieService(createConfigService({ 'auth.cookieDomain': '.reputo.dev' }));
      const response = createMockResponse();

      service.setSessionCookie(response, 'session', new Date());

      expect(response.cookie.mock.calls[0][2].domain).toBe('.reputo.dev');
    });
  });
});
