import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuthConsentGrantRepository } from '../../../src/consent/oauth-consent-grant.repository';
import type { PrismaService } from '../../../src/persistence';
import { randomUUIDv7 } from '../../utils/uuid';

describe('OAuthConsentGrantRepository', () => {
  let oauthConsentGrant: {
    create: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  let prisma: { oAuthConsentGrant: typeof oauthConsentGrant };
  let repository: OAuthConsentGrantRepository;

  beforeEach(() => {
    oauthConsentGrant = {
      create: vi.fn(async () => ({})),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    };
    prisma = { oAuthConsentGrant: oauthConsentGrant };
    repository = new OAuthConsentGrantRepository(prisma as unknown as PrismaService);
  });

  it('translates the wire provider to the Prisma enum on create', async () => {
    const data = {
      provider: 'deep-id' as const,
      source: 'voting-portal',
      state: 'state',
      codeVerifier: 'verifier',
      expiresAt: new Date('2026-05-06T12:10:00.000Z'),
    };

    await repository.create(data);

    expect(oauthConsentGrant.create).toHaveBeenCalledWith({
      data: {
        provider: 'deep_id',
        source: 'voting-portal',
        state: 'state',
        codeVerifier: 'verifier',
        expiresAt: data.expiresAt,
      },
    });
  });

  it('finds an active grant by provider and state filtering on expiresAt', async () => {
    const row = {
      id: randomUUIDv7(),
      provider: 'deep_id',
      source: 'voting-portal',
      state: 'state',
      codeVerifier: 'verifier',
      expiresAt: new Date('2026-05-06T12:10:00.000Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    oauthConsentGrant.findFirst.mockResolvedValue(row);

    const result = await repository.findActiveByProviderAndState('deep-id', 'state');

    expect(result).toMatchObject({
      _id: row.id,
      provider: 'deep-id',
      source: 'voting-portal',
      state: 'state',
      codeVerifier: 'verifier',
      expiresAt: row.expiresAt,
    });
    const [args] = oauthConsentGrant.findFirst.mock.calls[0];
    expect(args).toMatchObject({
      where: {
        provider: 'deep_id',
        state: 'state',
        expiresAt: { gt: expect.any(Date) },
      },
    });
  });

  it('returns null when no active grant is found', async () => {
    oauthConsentGrant.findFirst.mockResolvedValue(null);

    await expect(repository.findActiveByProviderAndState('deep-id', 'missing')).resolves.toBeNull();
  });

  it('returns false when deleting a missing grant', async () => {
    oauthConsentGrant.deleteMany.mockResolvedValue({ count: 0 });

    await expect(repository.deleteByProviderAndState('deep-id', 'missing-state')).resolves.toBe(false);

    expect(oauthConsentGrant.deleteMany).toHaveBeenCalledWith({
      where: { provider: 'deep_id', state: 'missing-state' },
    });
  });

  it('returns true when deleting an existing grant', async () => {
    oauthConsentGrant.deleteMany.mockResolvedValue({ count: 1 });

    await expect(repository.deleteByProviderAndState('deep-id', 'state')).resolves.toBe(true);
  });
});
