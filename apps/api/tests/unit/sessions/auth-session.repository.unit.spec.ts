import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../src/persistence';
import { AuthSessionRepository } from '../../../src/sessions/auth-session.repository';

const FIXED_NOW = new Date('2026-05-21T00:00:00.000Z');
const TEST_UUID = '01940000-0000-7000-8000-000000000000';
const TEST_USER_UUID = '01940000-0000-7000-8000-000000000001';

function createPrismaSession(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_UUID,
    sessionId: 'session-1',
    provider: 'deep_id',
    userId: TEST_USER_UUID,
    accessTokenCiphertext: 'ct-access',
    refreshTokenCiphertext: 'ct-refresh',
    accessTokenExpiresAt: new Date(FIXED_NOW.getTime() + 60_000),
    refreshTokenExpiresAt: new Date(FIXED_NOW.getTime() + 600_000),
    scope: ['openid', 'profile'],
    state: 'state-1',
    codeVerifier: 'verifier-1',
    lastRefreshedAt: null,
    revokedAt: null,
    expiresAt: new Date(FIXED_NOW.getTime() + 3_600_000),
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

describe('AuthSessionRepository', () => {
  let prismaMock: {
    authSession: {
      create: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      groupBy: ReturnType<typeof vi.fn>;
    };
  };
  let repository: AuthSessionRepository;

  beforeEach(() => {
    prismaMock = {
      authSession: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        groupBy: vi.fn(),
      },
    };
    repository = new AuthSessionRepository(prismaMock as unknown as PrismaService);
  });

  describe('create', () => {
    it('forwards the wire provider as the Prisma enum and returns the full secret-bearing row', async () => {
      prismaMock.authSession.create.mockResolvedValue(createPrismaSession());

      const session = await repository.create({
        sessionId: 'session-1',
        provider: 'deep-id',
        userId: TEST_USER_UUID,
        accessTokenCiphertext: 'ct-access',
        refreshTokenCiphertext: 'ct-refresh',
        accessTokenExpiresAt: new Date(FIXED_NOW.getTime() + 60_000),
        refreshTokenExpiresAt: new Date(FIXED_NOW.getTime() + 600_000),
        scope: ['openid', 'profile'],
        state: 'state-1',
        codeVerifier: 'verifier-1',
        expiresAt: new Date(FIXED_NOW.getTime() + 3_600_000),
      });

      expect(prismaMock.authSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sessionId: 'session-1',
            provider: 'deep_id',
            userId: TEST_USER_UUID,
            scope: { set: ['openid', 'profile'] },
          }),
        }),
      );
      expect(session.accessTokenCiphertext).toBe('ct-access');
      expect(session.provider).toBe('deep-id');
    });
  });

  describe('findActiveBySessionId', () => {
    it('filters out revoked and expired sessions and projects the public shape by default', async () => {
      prismaMock.authSession.findFirst.mockResolvedValue(createPrismaSession());

      const row = await repository.findActiveBySessionId('session-1');

      expect(prismaMock.authSession.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sessionId: 'session-1',
            revokedAt: null,
            expiresAt: { gt: expect.any(Date) },
          }),
        }),
      );
      expect((row as { accessTokenCiphertext?: string }).accessTokenCiphertext).toBeUndefined();
    });

    it('returns ciphertexts and PKCE material when includeSecrets is true', async () => {
      prismaMock.authSession.findFirst.mockResolvedValue(createPrismaSession());

      const row = await repository.findActiveBySessionId('session-1', true);

      expect(row?.accessTokenCiphertext).toBe('ct-access');
      expect(row?.refreshTokenCiphertext).toBe('ct-refresh');
      expect(row?.state).toBe('state-1');
      expect(row?.codeVerifier).toBe('verifier-1');
    });
  });

  describe('updateAfterRefresh', () => {
    it('uses the compound where clause so revoked sessions cannot be silently refreshed', async () => {
      prismaMock.authSession.update.mockResolvedValue(
        createPrismaSession({
          accessTokenCiphertext: 'new-access',
          refreshTokenCiphertext: 'new-refresh',
        }),
      );

      const result = await repository.updateAfterRefresh('session-1', {
        accessTokenCiphertext: 'new-access',
        refreshTokenCiphertext: 'new-refresh',
        accessTokenExpiresAt: new Date(),
        refreshTokenExpiresAt: new Date(),
        scope: ['openid'],
        lastRefreshedAt: new Date(),
        expiresAt: new Date(),
      });

      expect(prismaMock.authSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sessionId: 'session-1',
            revokedAt: null,
            expiresAt: { gt: expect.any(Date) },
          }),
        }),
      );
      expect(result?.accessTokenCiphertext).toBe('new-access');
    });

    it('returns null when the Prisma update misses (P2025) because the session was revoked or expired', async () => {
      prismaMock.authSession.update.mockRejectedValue({ code: 'P2025' });

      await expect(
        repository.updateAfterRefresh('session-1', {
          accessTokenCiphertext: 'new-access',
        }),
      ).resolves.toBeNull();
    });
  });

  describe('revokeBySessionId', () => {
    it('swallows P2025 so revoking an already-revoked session is idempotent', async () => {
      prismaMock.authSession.update.mockRejectedValue({ code: 'P2025' });

      await expect(repository.revokeBySessionId('session-1')).resolves.toBeUndefined();
    });

    it('forces expiresAt to the revoked moment so cleanup picks the row up', async () => {
      prismaMock.authSession.update.mockResolvedValue(createPrismaSession({ revokedAt: FIXED_NOW }));

      await repository.revokeBySessionId('session-1', FIXED_NOW);

      expect(prismaMock.authSession.update).toHaveBeenCalledWith({
        where: { sessionId: 'session-1', revokedAt: null },
        data: { revokedAt: FIXED_NOW, expiresAt: FIXED_NOW },
      });
    });
  });

  describe('revokeAllByUserId', () => {
    it('returns the number of sessions touched', async () => {
      prismaMock.authSession.updateMany.mockResolvedValue({ count: 4 });

      const count = await repository.revokeAllByUserId(TEST_USER_UUID, FIXED_NOW);

      expect(prismaMock.authSession.updateMany).toHaveBeenCalledWith({
        where: { userId: TEST_USER_UUID, revokedAt: null, expiresAt: { gt: FIXED_NOW } },
        data: { revokedAt: FIXED_NOW, expiresAt: FIXED_NOW },
      });
      expect(count).toBe(4);
    });
  });

  describe('aggregateActivityByUserIds', () => {
    it('returns empty map without hitting Prisma when the input is empty', async () => {
      await expect(repository.aggregateActivityByUserIds([])).resolves.toEqual(new Map());
      expect(prismaMock.authSession.groupBy).not.toHaveBeenCalled();
    });

    it('merges last-sign-in and active-session-count groupBy results, defaulting count to 0', async () => {
      prismaMock.authSession.groupBy
        .mockResolvedValueOnce([
          { userId: TEST_USER_UUID, _max: { createdAt: new Date('2026-04-01T00:00:00.000Z') } },
          { userId: 'user-2', _max: { createdAt: new Date('2026-04-02T00:00:00.000Z') } },
        ])
        .mockResolvedValueOnce([{ userId: TEST_USER_UUID, _count: { _all: 2 } }]);

      const activity = await repository.aggregateActivityByUserIds([TEST_USER_UUID, 'user-2'], FIXED_NOW);

      expect(activity.get(TEST_USER_UUID)).toEqual({
        lastSignInAt: new Date('2026-04-01T00:00:00.000Z'),
        activeSessionCount: 2,
      });
      expect(activity.get('user-2')).toEqual({
        lastSignInAt: new Date('2026-04-02T00:00:00.000Z'),
        activeSessionCount: 0,
      });
    });
  });
});
