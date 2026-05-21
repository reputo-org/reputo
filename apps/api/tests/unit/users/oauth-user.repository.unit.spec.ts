import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../src/persistence';
import { OAuthUserRepository } from '../../../src/users/oauth-user.repository';

const FIXED_NOW = new Date('2026-05-21T00:00:00.000Z');
const TEST_UUID = '01940000-0000-7000-8000-000000000000';

function createPrismaRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_UUID,
    provider: 'deep_id',
    sub: 'did:deep-id:abc',
    aud: [],
    authTime: null,
    email: null,
    emailVerified: null,
    iat: null,
    iss: null,
    picture: null,
    rat: null,
    username: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

describe('OAuthUserRepository', () => {
  let prismaMock: {
    oAuthUser: {
      upsert: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
  let repository: OAuthUserRepository;

  beforeEach(() => {
    prismaMock = {
      oAuthUser: {
        upsert: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    };
    repository = new OAuthUserRepository(prismaMock as unknown as PrismaService);
  });

  describe('upsertBySub', () => {
    it('translates the hyphenated wire provider to the Prisma enum and writes camelCase columns', async () => {
      prismaMock.oAuthUser.upsert.mockResolvedValue(
        createPrismaRow({
          email: 'jane@example.com',
          emailVerified: true,
          username: 'jane',
          aud: ['deep-id-test-client'],
          authTime: 1775166617,
        }),
      );

      const row = await repository.upsertBySub('deep-id', 'did:deep-id:abc', {
        aud: ['deep-id-test-client'],
        auth_time: 1775166617,
        email: 'jane@example.com',
        email_verified: true,
        username: 'jane',
      });

      expect(prismaMock.oAuthUser.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { provider_sub: { provider: 'deep_id', sub: 'did:deep-id:abc' } },
          update: expect.objectContaining({
            aud: { set: ['deep-id-test-client'] },
            authTime: 1775166617,
            email: 'jane@example.com',
            emailVerified: true,
            username: 'jane',
          }),
          create: expect.objectContaining({
            provider: 'deep_id',
            sub: 'did:deep-id:abc',
            aud: ['deep-id-test-client'],
            authTime: 1775166617,
            email: 'jane@example.com',
            emailVerified: true,
            username: 'jane',
          }),
        }),
      );
      expect(row._id).toBe(TEST_UUID);
      expect(row.provider).toBe('deep-id');
      expect(row.email).toBe('jane@example.com');
    });

    it('clears explicitly-undefined fields with null (matching the prior $unset semantics)', async () => {
      prismaMock.oAuthUser.upsert.mockResolvedValue(createPrismaRow());

      await repository.upsertBySub('deep-id', 'did:deep-id:abc', {
        aud: undefined,
        auth_time: undefined,
        email: undefined,
        email_verified: undefined,
        iat: undefined,
        iss: undefined,
        picture: undefined,
        rat: undefined,
        username: undefined,
      });

      const update = prismaMock.oAuthUser.upsert.mock.calls[0][0].update;
      expect(update).toEqual({
        aud: { set: [] },
        authTime: null,
        email: null,
        emailVerified: null,
        iat: null,
        iss: null,
        picture: null,
        rat: null,
        username: null,
      });
    });

    it('omits unmentioned fields so they remain unchanged (mock-login case)', async () => {
      prismaMock.oAuthUser.upsert.mockResolvedValue(createPrismaRow());

      await repository.upsertBySub('deep-id', 'did:deep-id:abc', {
        email: 'mock@example.com',
        email_verified: true,
        username: 'mock',
      });

      const update = prismaMock.oAuthUser.upsert.mock.calls[0][0].update;
      expect(Object.keys(update).sort()).toEqual(['email', 'emailVerified', 'username']);
    });

    it('maps an empty Prisma aud array back to undefined for downstream JSON', async () => {
      prismaMock.oAuthUser.upsert.mockResolvedValue(createPrismaRow());

      const row = await repository.upsertBySub('deep-id', 'did:deep-id:abc', {});

      expect(row.aud).toBeUndefined();
    });
  });

  describe('findById', () => {
    it('returns the row when present', async () => {
      prismaMock.oAuthUser.findUnique.mockResolvedValue(createPrismaRow({ email: 'jane@example.com' }));

      const row = await repository.findById(TEST_UUID);

      expect(prismaMock.oAuthUser.findUnique).toHaveBeenCalledWith({ where: { id: TEST_UUID } });
      expect(row?._id).toBe(TEST_UUID);
      expect(row?.email).toBe('jane@example.com');
    });

    it('returns null when not found', async () => {
      prismaMock.oAuthUser.findUnique.mockResolvedValue(null);
      await expect(repository.findById(TEST_UUID)).resolves.toBeNull();
    });
  });

  describe('findByIds', () => {
    it('returns an empty array without hitting Prisma when the input is empty', async () => {
      await expect(repository.findByIds([])).resolves.toEqual([]);
      expect(prismaMock.oAuthUser.findMany).not.toHaveBeenCalled();
    });

    it('passes the id list to Prisma findMany', async () => {
      prismaMock.oAuthUser.findMany.mockResolvedValue([createPrismaRow()]);
      await repository.findByIds([TEST_UUID]);
      expect(prismaMock.oAuthUser.findMany).toHaveBeenCalledWith({ where: { id: { in: [TEST_UUID] } } });
    });
  });

  describe('findByProviderEmail', () => {
    it('normalizes the email before querying', async () => {
      prismaMock.oAuthUser.findFirst.mockResolvedValue(null);

      await repository.findByProviderEmail('deep-id', '  Jane@Example.COM  ');

      expect(prismaMock.oAuthUser.findFirst).toHaveBeenCalledWith({
        where: { provider: 'deep_id', email: 'jane@example.com' },
        orderBy: { updatedAt: 'desc' },
      });
    });

    it('returns null when the email is blank', async () => {
      await expect(repository.findByProviderEmail('deep-id', '   ')).resolves.toBeNull();
      expect(prismaMock.oAuthUser.findFirst).not.toHaveBeenCalled();
    });
  });
});
