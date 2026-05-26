import type { Repository } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuthConsentGrantRepository } from '../../../src/consent/oauth-consent-grant.repository';
import type { OAuthConsentGrantEntity } from '../../../src/persistence';
import { randomUUIDv7 } from '../../utils/uuid';

describe('OAuthConsentGrantRepository', () => {
  let repoMock: Repository<OAuthConsentGrantEntity> & {
    findOne: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  let repository: OAuthConsentGrantRepository;

  beforeEach(() => {
    repoMock = {
      findOne: vi.fn(),
      save: vi.fn(async (entity) => entity),
      delete: vi.fn(),
      create: vi.fn((data) => data),
    } as unknown as typeof repoMock;
    repository = new OAuthConsentGrantRepository(repoMock as unknown as Repository<OAuthConsentGrantEntity>);
  });

  it('persists a new grant via repo.create + repo.save', async () => {
    const data = {
      provider: 'deep-id' as const,
      source: 'voting-portal',
      state: 'state',
      codeVerifier: 'verifier',
      expiresAt: new Date('2026-05-06T12:10:00.000Z'),
    };

    await repository.create(data);

    expect(repoMock.create).toHaveBeenCalledWith({
      provider: 'deep-id',
      source: 'voting-portal',
      state: 'state',
      codeVerifier: 'verifier',
      expiresAt: data.expiresAt,
    });
    expect(repoMock.save).toHaveBeenCalled();
  });

  it('finds an active grant by provider and state filtering on expiresAt', async () => {
    const row = {
      id: randomUUIDv7(),
      provider: 'deep-id',
      source: 'voting-portal',
      state: 'state',
      codeVerifier: 'verifier',
      expiresAt: new Date('2026-05-06T12:10:00.000Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    repoMock.findOne.mockResolvedValue(row);

    const result = await repository.findActiveByProviderAndState('deep-id', 'state');

    expect(result).toMatchObject({
      _id: row.id,
      provider: 'deep-id',
      source: 'voting-portal',
      state: 'state',
      codeVerifier: 'verifier',
      expiresAt: row.expiresAt,
    });
    const [args] = repoMock.findOne.mock.calls[0];
    expect((args as { where: { provider: string; state: string; expiresAt: unknown } }).where.provider).toBe('deep-id');
    expect((args as { where: { state: string } }).where.state).toBe('state');
    expect((args as { where: { expiresAt: unknown } }).where.expiresAt).toBeDefined();
  });

  it('returns null when no active grant is found', async () => {
    repoMock.findOne.mockResolvedValue(null);

    await expect(repository.findActiveByProviderAndState('deep-id', 'missing')).resolves.toBeNull();
  });

  it('returns false when deleting a missing grant', async () => {
    repoMock.delete.mockResolvedValue({ affected: 0 });

    await expect(repository.deleteByProviderAndState('deep-id', 'missing-state')).resolves.toBe(false);

    expect(repoMock.delete).toHaveBeenCalledWith({ provider: 'deep-id', state: 'missing-state' });
  });

  it('returns true when deleting an existing grant', async () => {
    repoMock.delete.mockResolvedValue({ affected: 1 });

    await expect(repository.deleteByProviderAndState('deep-id', 'state')).resolves.toBe(true);
  });
});
