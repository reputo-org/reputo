import type { Repository } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSessionEntity } from '../../../src/persistence';
import { AuthSessionRepository } from '../../../src/sessions/auth-session.repository';

const FIXED_NOW = new Date('2026-05-21T00:00:00.000Z');
const TEST_UUID = '01940000-0000-7000-8000-000000000000';
const TEST_USER_UUID = '01940000-0000-7000-8000-000000000001';

function createEntity(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_UUID,
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
    lastRefreshedAt: null,
    revokedAt: null,
    expiresAt: new Date(FIXED_NOW.getTime() + 3_600_000),
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

describe('AuthSessionRepository', () => {
  let repoMock: Repository<AuthSessionEntity> & {
    findOne: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
  };
  let repository: AuthSessionRepository;

  beforeEach(() => {
    repoMock = {
      findOne: vi.fn(),
      save: vi.fn(async (entity) => entity),
      update: vi.fn(),
      create: vi.fn((data) => data),
      createQueryBuilder: vi.fn(),
    } as unknown as typeof repoMock;

    repository = new AuthSessionRepository(repoMock as unknown as Repository<AuthSessionEntity>);
  });

  describe('create', () => {
    it('persists the session and returns the row with secrets', async () => {
      repoMock.save.mockResolvedValue(createEntity());

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

      expect(repoMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          provider: 'deep-id',
          userId: TEST_USER_UUID,
          scope: ['openid', 'profile'],
        }),
      );
      expect(repoMock.save).toHaveBeenCalled();
      expect(session.accessTokenCiphertext).toBe('ct-access');
      expect(session.provider).toBe('deep-id');
    });
  });

  describe('findActiveBySessionId', () => {
    it('filters out revoked and expired sessions and projects the public shape by default', async () => {
      repoMock.findOne.mockResolvedValue(createEntity());

      const row = await repository.findActiveBySessionId('session-1');

      const call = repoMock.findOne.mock.calls[0][0];
      expect(call.where.sessionId).toBe('session-1');
      expect(call.where.revokedAt).toBeDefined();
      expect(call.where.expiresAt).toBeDefined();
      expect((row as { accessTokenCiphertext?: string }).accessTokenCiphertext).toBeUndefined();
    });

    it('returns ciphertexts and PKCE material when includeSecrets is true', async () => {
      repoMock.findOne.mockResolvedValue(createEntity());

      const row = await repository.findActiveBySessionId('session-1', true);

      expect(row?.accessTokenCiphertext).toBe('ct-access');
      expect(row?.refreshTokenCiphertext).toBe('ct-refresh');
      expect(row?.state).toBe('state-1');
      expect(row?.codeVerifier).toBe('verifier-1');
    });

    it('returns null when no row matches', async () => {
      repoMock.findOne.mockResolvedValue(null);
      await expect(repository.findActiveBySessionId('session-1')).resolves.toBeNull();
    });
  });

  describe('updateAfterRefresh', () => {
    it('uses the compound where clause so revoked sessions cannot be silently refreshed', async () => {
      const found = createEntity();
      repoMock.findOne.mockResolvedValue(found);
      repoMock.save.mockImplementation(async (entity) => ({
        ...entity,
        accessTokenCiphertext: 'new-access',
        refreshTokenCiphertext: 'new-refresh',
      }));

      const result = await repository.updateAfterRefresh('session-1', {
        accessTokenCiphertext: 'new-access',
        refreshTokenCiphertext: 'new-refresh',
        accessTokenExpiresAt: new Date(),
        refreshTokenExpiresAt: new Date(),
        scope: ['openid'],
        lastRefreshedAt: new Date(),
        expiresAt: new Date(),
      });

      const findCall = repoMock.findOne.mock.calls[0][0];
      expect(findCall.where.sessionId).toBe('session-1');
      expect(findCall.where.revokedAt).toBeDefined();
      expect(findCall.where.expiresAt).toBeDefined();
      expect(result?.accessTokenCiphertext).toBe('new-access');
    });

    it('returns null when the row is not found (revoked or expired)', async () => {
      repoMock.findOne.mockResolvedValue(null);

      await expect(
        repository.updateAfterRefresh('session-1', { accessTokenCiphertext: 'new-access' }),
      ).resolves.toBeNull();
    });
  });

  describe('revokeBySessionId', () => {
    it('is idempotent: a missing row is treated as a no-op (affected=0)', async () => {
      repoMock.update.mockResolvedValue({ affected: 0 });

      await expect(repository.revokeBySessionId('session-1')).resolves.toBeUndefined();
    });

    it('forces expiresAt to the revoked moment so cleanup picks the row up', async () => {
      repoMock.update.mockResolvedValue({ affected: 1 });

      await repository.revokeBySessionId('session-1', FIXED_NOW);

      const updateCall = repoMock.update.mock.calls[0];
      const where = updateCall[0] as { sessionId: string; revokedAt: unknown };
      const data = updateCall[1] as { revokedAt: Date; expiresAt: Date };
      expect(where.sessionId).toBe('session-1');
      expect(where.revokedAt).toBeDefined();
      expect(data.revokedAt).toBe(FIXED_NOW);
      expect(data.expiresAt).toBe(FIXED_NOW);
    });
  });

  describe('revokeAllByUserId', () => {
    it('returns the number of sessions touched', async () => {
      repoMock.update.mockResolvedValue({ affected: 4 });

      const count = await repository.revokeAllByUserId(TEST_USER_UUID, FIXED_NOW);

      const updateCall = repoMock.update.mock.calls[0];
      const where = updateCall[0] as { userId: string };
      const data = updateCall[1] as { revokedAt: Date; expiresAt: Date };
      expect(where.userId).toBe(TEST_USER_UUID);
      expect(data.revokedAt).toBe(FIXED_NOW);
      expect(data.expiresAt).toBe(FIXED_NOW);
      expect(count).toBe(4);
    });
  });

  describe('deleteExpired', () => {
    it('deletes rows whose expires_at is in the past and reports the count', async () => {
      const execute = vi.fn().mockResolvedValue({ affected: 5 });
      const where = vi.fn().mockReturnValue({ execute });
      const del = vi.fn().mockReturnValue({ where });
      repoMock.createQueryBuilder.mockReturnValue({ delete: del });

      const result = await repository.deleteExpired(FIXED_NOW);

      expect(repoMock.createQueryBuilder).toHaveBeenCalled();
      expect(del).toHaveBeenCalled();
      expect(where).toHaveBeenCalledWith('expires_at < :now', { now: FIXED_NOW });
      expect(result).toEqual({ deletedCount: 5 });
    });

    it('returns zero when no rows are expired', async () => {
      const execute = vi.fn().mockResolvedValue({ affected: 0 });
      const where = vi.fn().mockReturnValue({ execute });
      const del = vi.fn().mockReturnValue({ where });
      repoMock.createQueryBuilder.mockReturnValue({ delete: del });

      const result = await repository.deleteExpired();
      expect(result).toEqual({ deletedCount: 0 });
    });
  });

  describe('aggregateActivityByUserIds', () => {
    it('returns empty map without hitting the DB when the input is empty', async () => {
      await expect(repository.aggregateActivityByUserIds([])).resolves.toEqual(new Map());
      expect(repoMock.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('merges last-sign-in and active-session-count results, defaulting count to 0', async () => {
      const lastSignInBuilder = {
        select: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        getRawMany: vi.fn().mockResolvedValue([
          { userId: TEST_USER_UUID, lastSignInAt: new Date('2026-04-01T00:00:00.000Z') },
          { userId: 'user-2', lastSignInAt: new Date('2026-04-02T00:00:00.000Z') },
        ]),
      };
      const activeCountBuilder = {
        select: vi.fn().mockReturnThis(),
        addSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        getRawMany: vi.fn().mockResolvedValue([{ userId: TEST_USER_UUID, count: 2 }]),
      };
      repoMock.createQueryBuilder
        .mockReturnValueOnce(
          lastSignInBuilder as unknown as ReturnType<Repository<AuthSessionEntity>['createQueryBuilder']>,
        )
        .mockReturnValueOnce(
          activeCountBuilder as unknown as ReturnType<Repository<AuthSessionEntity>['createQueryBuilder']>,
        );

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
