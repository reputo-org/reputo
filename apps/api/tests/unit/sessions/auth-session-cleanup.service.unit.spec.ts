import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthSessionRepository } from '../../../src/sessions/auth-session.repository';
import { AuthSessionCleanupService } from '../../../src/sessions/auth-session-cleanup.service';

describe('AuthSessionCleanupService', () => {
  let repoMock: AuthSessionRepository & {
    deleteExpired: ReturnType<typeof vi.fn>;
  };

  function createService(intervalMs = 0): AuthSessionCleanupService {
    const configService = {
      get: vi.fn(() => intervalMs),
    } as unknown as ConfigService;
    return new AuthSessionCleanupService(repoMock as unknown as AuthSessionRepository, configService);
  }

  beforeEach(() => {
    repoMock = {
      deleteExpired: vi.fn(),
    } as unknown as typeof repoMock;
  });

  it('deletes rows whose expiresAt is in the past', async () => {
    repoMock.deleteExpired.mockResolvedValue({ deletedCount: 3 });
    const service = createService();
    const now = new Date('2026-05-21T12:00:00.000Z');

    const result = await service.runOnce(now);

    expect(repoMock.deleteExpired).toHaveBeenCalledWith(now);
    expect(result.deletedCount).toBe(3);
  });

  it('returns zero when there are no expired sessions', async () => {
    repoMock.deleteExpired.mockResolvedValue({ deletedCount: 0 });
    const service = createService();

    const result = await service.runOnce();

    expect(result.deletedCount).toBe(0);
  });

  it('skips scheduling the cron when the configured interval is 0', () => {
    const service = createService(0);
    service.onModuleInit();

    expect(() => service.onModuleDestroy()).not.toThrow();
  });
});
