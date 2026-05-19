import { type INestApplication, UnauthorizedException, VersioningType } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthController } from '../../../src/auth/auth.controller';
import { AuthService } from '../../../src/auth/auth.service';
import { SessionAuthGuard } from '../../../src/shared/guards/session-auth.guard';
import { setAuthRequestContext } from '../../../src/shared/types';

const userId = new Types.ObjectId();

const MOCK_SESSION_VIEW = {
  authenticated: true,
  provider: 'deep-id' as const,
  role: 'owner' as const,
  expiresAt: '2026-05-02T10:00:00.000Z',
  scope: ['openid', 'profile', 'email', 'offline_access'],
  user: {
    id: userId.toString(),
    provider: 'deep-id' as const,
    role: 'owner' as const,
    sub: 'did:deep-id:123',
    email: 'jane@example.com',
    username: 'jane',
  },
};

const MOCK_AUTH_CONTEXT = {
  role: 'owner' as const,
  session: {
    _id: new Types.ObjectId(),
    sessionId: 'session-123',
    provider: 'deep-id' as const,
    userId,
    accessTokenExpiresAt: new Date('2026-05-02T10:00:00.000Z'),
    refreshTokenExpiresAt: new Date('2026-06-02T10:00:00.000Z'),
    scope: ['openid', 'profile', 'email', 'offline_access'],
    expiresAt: new Date('2026-06-02T10:00:00.000Z'),
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  },
  user: {
    _id: userId,
    provider: 'deep-id' as const,
    sub: 'did:deep-id:123',
    email: 'jane@example.com',
    email_verified: true,
    username: 'jane',
    createdAt: new Date('2026-04-03T10:00:00.000Z'),
    updatedAt: new Date('2026-04-03T10:00:00.000Z'),
  },
};

describe('AuthController (e2e)', () => {
  let app: INestApplication;
  const authService = {
    getLoginRedirectUrl: vi.fn(),
    handleCallback: vi.fn(),
    getCurrentSession: vi.fn(),
    requireSession: vi.fn(),
    logout: vi.fn(),
    toCurrentSessionView: vi.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
        Reflector,
        {
          provide: APP_GUARD,
          useFactory: (reflector: Reflector) => new SessionAuthGuard(reflector, authService as any),
          inject: [Reflector],
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
      prefix: 'api/v',
    });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/auth/deep-id/login', () => {
    it('returns a 302 redirect to the Deep ID authorization URL', async () => {
      authService.getLoginRedirectUrl.mockResolvedValue('https://identity.deep-id.ai/oauth2/auth?state=abc');

      const response = await request(app.getHttpServer()).get('/api/v1/auth/deep-id/login');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('https://identity.deep-id.ai/oauth2/auth?state=abc');
      expect(authService.getLoginRedirectUrl).toHaveBeenCalledWith('deep-id', expect.anything(), expect.anything());
      expect(authService.requireSession).not.toHaveBeenCalled();
    });

    it('is a public route that does not require a session', async () => {
      authService.getLoginRedirectUrl.mockResolvedValue('https://example.com');

      const response = await request(app.getHttpServer()).get('/api/v1/auth/deep-id/login');

      expect(response.status).toBe(302);
      expect(authService.requireSession).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/auth/deep-id/callback', () => {
    it('returns a 302 redirect on successful callback', async () => {
      authService.handleCallback.mockResolvedValue('http://localhost:5173');

      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/deep-id/callback')
        .query({ code: 'auth-code', state: 'state-123' });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('http://localhost:5173');
      expect(authService.handleCallback).toHaveBeenCalledWith(
        'deep-id',
        expect.objectContaining({ code: 'auth-code', state: 'state-123' }),
        expect.anything(),
        expect.anything(),
      );
      expect(authService.requireSession).not.toHaveBeenCalled();
    });

    it('returns 401 when state is invalid', async () => {
      authService.handleCallback.mockRejectedValue(new UnauthorizedException('OAuth auth state mismatch.'));

      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/deep-id/callback')
        .query({ code: 'code', state: 'wrong-state' });

      expect(response.status).toBe(401);
    });

    it('is a public route that does not require a session', async () => {
      authService.handleCallback.mockResolvedValue('http://localhost:5173');

      await request(app.getHttpServer()).get('/api/v1/auth/deep-id/callback').query({ code: 'code', state: 'state' });

      expect(authService.requireSession).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('returns 200 with the session bootstrap payload when authenticated', async () => {
      authService.requireSession.mockImplementation(async (req: any) => {
        setAuthRequestContext(req, MOCK_AUTH_CONTEXT as any);
        return MOCK_AUTH_CONTEXT;
      });
      authService.toCurrentSessionView.mockReturnValue(MOCK_SESSION_VIEW);

      const response = await request(app.getHttpServer()).get('/api/v1/auth/me');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        authenticated: true,
        provider: 'deep-id',
        role: 'owner',
        user: {
          role: 'owner',
          sub: 'did:deep-id:123',
          email: 'jane@example.com',
        },
      });
      expect(authService.toCurrentSessionView).toHaveBeenCalledWith(
        MOCK_AUTH_CONTEXT.session,
        MOCK_AUTH_CONTEXT.user,
        'owner',
      );
    });

    it('returns 401 when no session cookie is present', async () => {
      authService.requireSession.mockRejectedValue(new UnauthorizedException('Authentication required.'));

      const response = await request(app.getHttpServer()).get('/api/v1/auth/me');

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('returns 204 when the session is successfully revoked', async () => {
      authService.requireSession.mockImplementation(async (req: any) => {
        setAuthRequestContext(req, MOCK_AUTH_CONTEXT as any);
        return MOCK_AUTH_CONTEXT;
      });
      authService.logout.mockResolvedValue(undefined);

      const response = await request(app.getHttpServer()).post('/api/v1/auth/logout');

      expect(response.status).toBe(204);
      expect(authService.logout).toHaveBeenCalledWith(MOCK_AUTH_CONTEXT.session, expect.anything());
    });

    it('returns 401 when not authenticated', async () => {
      authService.requireSession.mockRejectedValue(new UnauthorizedException('Authentication required.'));

      const response = await request(app.getHttpServer()).post('/api/v1/auth/logout');

      expect(response.status).toBe(401);
    });
  });
});
