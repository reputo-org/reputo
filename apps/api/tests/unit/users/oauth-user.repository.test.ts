import type { EntityManager, Repository } from 'typeorm';
import { In } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuthUserEntity } from '../../../src/persistence';
import { OAuthUserRepository } from '../../../src/users/oauth-user.repository';

const FIXED_NOW = new Date('2026-05-21T00:00:00.000Z');
const TEST_UUID = '01940000-0000-7000-8000-000000000000';

function createEntity(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_UUID,
    provider: 'deep-id',
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
  let repoMock: Repository<OAuthUserEntity> & {
    findOne: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
  };
  let txRepo: typeof repoMock;
  let repository: OAuthUserRepository;

  beforeEach(() => {
    txRepo = {
      findOne: vi.fn(),
      save: vi.fn(async (entity) => entity),
    } as unknown as typeof repoMock;

    const txManager = {
      getRepository: vi.fn(() => txRepo),
    } as unknown as EntityManager;

    repoMock = {
      findOne: vi.fn(),
      find: vi.fn(),
      save: vi.fn(async (entity) => entity),
      manager: {
        transaction: vi.fn(async (cb: (m: EntityManager) => unknown) => cb(txManager)),
        getRepository: vi.fn(() => txRepo),
      },
    } as unknown as typeof repoMock;

    repository = new OAuthUserRepository(repoMock as unknown as Repository<OAuthUserEntity>);
  });

  describe('upsertBySub', () => {
    it('inserts a new row when none exists and maps the wire shape', async () => {
      txRepo.findOne.mockResolvedValue(null);
      txRepo.save.mockImplementation(async (entity) => ({
        ...entity,
        id: TEST_UUID,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      }));

      const row = await repository.upsertBySub('deep-id', 'did:deep-id:abc', {
        aud: ['deep-id-test-client'],
        auth_time: 1775166617,
        email: 'jane@example.com',
        email_verified: true,
        username: 'jane',
      });

      expect(txRepo.findOne).toHaveBeenCalledWith({ where: { provider: 'deep-id', sub: 'did:deep-id:abc' } });
      const saved = txRepo.save.mock.calls[0][0] as Record<string, unknown>;
      expect(saved).toMatchObject({
        provider: 'deep-id',
        sub: 'did:deep-id:abc',
        aud: ['deep-id-test-client'],
        authTime: 1775166617,
        email: 'jane@example.com',
        emailVerified: true,
        username: 'jane',
      });
      expect(row._id).toBe(TEST_UUID);
      expect(row.provider).toBe('deep-id');
      expect(row.email).toBe('jane@example.com');
    });

    it('updates an existing row by mutating it in place before save', async () => {
      const existing = createEntity({
        email: 'old@example.com',
        emailVerified: false,
        username: 'old',
        aud: ['old-aud'],
      });
      txRepo.findOne.mockResolvedValue(existing);
      txRepo.save.mockImplementation(async (entity) => entity);

      await repository.upsertBySub('deep-id', 'did:deep-id:abc', {
        email: 'mock@example.com',
        email_verified: true,
        username: 'mock',
      });

      expect(existing.email).toBe('mock@example.com');
      expect(existing.emailVerified).toBe(true);
      expect(existing.username).toBe('mock');
      expect(existing.aud).toEqual(['old-aud']);
    });

    it('clears explicitly-undefined fields with null (matching the prior $unset semantics)', async () => {
      const existing = createEntity({
        aud: ['x'],
        authTime: 1,
        email: 'x',
        emailVerified: true,
        iat: 1,
        iss: 'iss',
        picture: 'p',
        rat: 1,
        username: 'u',
      });
      txRepo.findOne.mockResolvedValue(existing);
      txRepo.save.mockImplementation(async (entity) => entity);

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

      expect(existing.aud).toEqual([]);
      expect(existing.authTime).toBeNull();
      expect(existing.email).toBeNull();
      expect(existing.emailVerified).toBeNull();
      expect(existing.iat).toBeNull();
      expect(existing.iss).toBeNull();
      expect(existing.picture).toBeNull();
      expect(existing.rat).toBeNull();
      expect(existing.username).toBeNull();
    });

    it('omits unmentioned fields so they remain unchanged (mock-login case)', async () => {
      const existing = createEntity({ email: 'old@example.com', emailVerified: false, username: 'old' });
      txRepo.findOne.mockResolvedValue(existing);
      txRepo.save.mockImplementation(async (entity) => entity);

      await repository.upsertBySub('deep-id', 'did:deep-id:abc', {
        email: 'mock@example.com',
        email_verified: true,
        username: 'mock',
      });

      expect(existing.email).toBe('mock@example.com');
      expect(existing.emailVerified).toBe(true);
      expect(existing.username).toBe('mock');
      expect(existing.aud).toEqual([]);
      expect(existing.authTime).toBeNull();
    });

    it('maps an empty entity aud array back to undefined for downstream JSON', async () => {
      txRepo.findOne.mockResolvedValue(null);
      txRepo.save.mockImplementation(async (entity) => ({
        ...entity,
        id: TEST_UUID,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      }));

      const row = await repository.upsertBySub('deep-id', 'did:deep-id:abc', {});

      expect(row.aud).toBeUndefined();
    });
  });

  describe('findById', () => {
    it('returns the row when present', async () => {
      repoMock.findOne.mockResolvedValue(createEntity({ email: 'jane@example.com' }));

      const row = await repository.findById(TEST_UUID);

      expect(repoMock.findOne).toHaveBeenCalledWith({ where: { id: TEST_UUID } });
      expect(row?._id).toBe(TEST_UUID);
      expect(row?.email).toBe('jane@example.com');
    });

    it('returns null when not found', async () => {
      repoMock.findOne.mockResolvedValue(null);
      await expect(repository.findById(TEST_UUID)).resolves.toBeNull();
    });
  });

  describe('findByIds', () => {
    it('returns an empty array without hitting the DB when the input is empty', async () => {
      await expect(repository.findByIds([])).resolves.toEqual([]);
      expect(repoMock.find).not.toHaveBeenCalled();
    });

    it('passes the id list to TypeORM find via In()', async () => {
      repoMock.find.mockResolvedValue([createEntity()]);
      await repository.findByIds([TEST_UUID]);
      expect(repoMock.find).toHaveBeenCalledWith({ where: { id: In([TEST_UUID]) } });
    });
  });

  describe('findByProviderEmail', () => {
    it('normalizes the email before querying', async () => {
      repoMock.findOne.mockResolvedValue(null);

      await repository.findByProviderEmail('deep-id', '  Jane@Example.COM  ');

      expect(repoMock.findOne).toHaveBeenCalledWith({
        where: { provider: 'deep-id', email: 'jane@example.com' },
        order: { updatedAt: 'DESC' },
      });
    });

    it('returns null when the email is blank', async () => {
      await expect(repository.findByProviderEmail('deep-id', '   ')).resolves.toBeNull();
      expect(repoMock.findOne).not.toHaveBeenCalled();
    });
  });
});
