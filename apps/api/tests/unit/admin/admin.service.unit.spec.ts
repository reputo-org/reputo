import { ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminService, OwnerEmailConflictError } from '../../../src/admin';

describe('AdminService', () => {
  const adminAllowlistRepository = {
    findActiveByProviderEmail: vi.fn(),
    findByProviderEmail: vi.fn(),
    countActiveOwners: vi.fn(),
    list: vi.fn(),
    createAdmin: vi.fn(),
    restore: vi.fn(),
    updateRole: vi.fn(),
    softRevoke: vi.fn(),
    isDuplicateKeyError: vi.fn(() => false),
  };
  const authSessionRepository = {
    revokeAllByUserId: vi.fn(),
    aggregateActivityByUserIds: vi.fn(async () => new Map()),
  };
  const oauthUserRepository = {
    findByIds: vi.fn(),
    findByProviderEmail: vi.fn(),
  };

  function createService(ownerEmail?: string, ownerProvider = 'deep-id') {
    const configService = {
      get: vi.fn((key: string) => {
        if (key === 'auth.ownerEmail') return ownerEmail;
        if (key === 'auth.ownerProvider') return ownerProvider;
        return undefined;
      }),
    } as unknown as ConfigService;

    return new AdminService(
      adminAllowlistRepository as never,
      authSessionRepository as never,
      oauthUserRepository as never,
      configService,
    );
  }

  beforeEach(() => {
    vi.resetAllMocks();
    adminAllowlistRepository.isDuplicateKeyError = vi.fn(() => false);
    authSessionRepository.aggregateActivityByUserIds = vi.fn(async () => new Map());
  });

  function actor(overrides: Partial<{ _id: Types.ObjectId; email: string }> = {}) {
    return {
      _id: overrides._id ?? new Types.ObjectId(),
      email: overrides.email ?? 'owner@example.com',
    } as never;
  }

  it('resolves an active allowlist role', async () => {
    const service = createService();
    adminAllowlistRepository.findActiveByProviderEmail.mockResolvedValue({
      _id: new Types.ObjectId(),
      provider: 'deep-id',
      email: 'admin@example.com',
      role: 'admin',
      invitedAt: new Date(),
    });

    await expect(service.resolveRole('deep-id', 'ADMIN@example.com')).resolves.toBe('admin');
    expect(adminAllowlistRepository.findActiveByProviderEmail).toHaveBeenCalledWith('deep-id', 'ADMIN@example.com');
  });

  it('returns null when no active allowlist role exists', async () => {
    const service = createService();
    adminAllowlistRepository.findActiveByProviderEmail.mockResolvedValue(null);

    await expect(service.resolveRole('deep-id', 'missing@example.com')).resolves.toBeNull();
  });

  it('addAdmin creates a new admin row', async () => {
    const service = createService();
    const acting = actor();
    adminAllowlistRepository.findByProviderEmail.mockResolvedValue(null);
    adminAllowlistRepository.createAdmin.mockResolvedValue({
      _id: new Types.ObjectId(),
      provider: 'deep-id',
      email: 'new@example.com',
      role: 'admin',
      invitedBy: acting._id,
      invitedAt: new Date('2026-04-01T00:00:00.000Z'),
    });

    const view = await service.addAdmin(acting, { provider: 'deep-id', email: ' New@Example.com ' });

    expect(view).toMatchObject({
      provider: 'deep-id',
      email: 'new@example.com',
      role: 'admin',
      invitedByEmail: 'owner@example.com',
    });
    expect(adminAllowlistRepository.createAdmin).toHaveBeenCalledWith(
      'deep-id',
      'new@example.com',
      'admin',
      acting._id,
    );
  });

  it('addAdmin rejects when an active row exists', async () => {
    const service = createService();
    adminAllowlistRepository.findByProviderEmail.mockResolvedValue({
      _id: new Types.ObjectId(),
      provider: 'deep-id',
      email: 'active@example.com',
      role: 'admin',
      invitedAt: new Date(),
    });

    await expect(
      service.addAdmin(actor(), { provider: 'deep-id', email: 'active@example.com' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(adminAllowlistRepository.createAdmin).not.toHaveBeenCalled();
  });

  it('addAdmin instructs callers to use restore for revoked rows', async () => {
    const service = createService();
    adminAllowlistRepository.findByProviderEmail.mockResolvedValue({
      _id: new Types.ObjectId(),
      provider: 'deep-id',
      email: 'revoked@example.com',
      role: 'admin',
      invitedAt: new Date(),
      revokedAt: new Date(),
    });

    await expect(
      service.addAdmin(actor(), { provider: 'deep-id', email: 'revoked@example.com' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(adminAllowlistRepository.createAdmin).not.toHaveBeenCalled();
  });

  it('restoreAdmin restores a revoked row', async () => {
    const service = createService();
    const acting = actor();
    adminAllowlistRepository.restore.mockResolvedValue({
      _id: new Types.ObjectId(),
      provider: 'deep-id',
      email: 'restore@example.com',
      role: 'admin',
      invitedBy: acting._id,
      invitedAt: new Date(),
    });

    const view = await service.restoreAdmin(acting, { provider: 'deep-id', email: 'RESTORE@example.com' });

    expect(view).toMatchObject({
      email: 'restore@example.com',
      role: 'admin',
      invitedByEmail: 'owner@example.com',
    });
    expect(adminAllowlistRepository.restore).toHaveBeenCalledWith('deep-id', 'restore@example.com', acting._id);
  });

  it('restoreAdmin throws 404 when no revoked row exists', async () => {
    const service = createService();
    adminAllowlistRepository.restore.mockResolvedValue(null);

    await expect(
      service.restoreAdmin(actor(), { provider: 'deep-id', email: 'missing@example.com' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updateRole demotes an admin to admin (no-op short-circuit)', async () => {
    const service = createService();
    const targetId = new Types.ObjectId();
    adminAllowlistRepository.findActiveByProviderEmail.mockResolvedValue({
      _id: targetId,
      provider: 'deep-id',
      email: 'admin@example.com',
      role: 'admin',
      invitedAt: new Date(),
    });
    oauthUserRepository.findByIds.mockResolvedValue([]);

    const view = await service.updateRole(actor(), { provider: 'deep-id', email: 'admin@example.com', role: 'admin' });

    expect(view.role).toBe('admin');
    expect(adminAllowlistRepository.updateRole).not.toHaveBeenCalled();
  });

  it('updateRole forbids self-demotion', async () => {
    const service = createService();
    const acting = actor({ email: 'owner@example.com' });
    adminAllowlistRepository.findActiveByProviderEmail.mockResolvedValue({
      _id: new Types.ObjectId(),
      provider: 'deep-id',
      email: 'owner@example.com',
      role: 'owner',
      invitedAt: new Date(),
    });

    await expect(
      service.updateRole(acting, { provider: 'deep-id', email: 'owner@example.com', role: 'admin' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('updateRole forbids demoting the last owner', async () => {
    const service = createService();
    adminAllowlistRepository.findActiveByProviderEmail.mockResolvedValue({
      _id: new Types.ObjectId(),
      provider: 'deep-id',
      email: 'last-owner@example.com',
      role: 'owner',
      invitedAt: new Date(),
    });
    adminAllowlistRepository.countActiveOwners.mockResolvedValue(1);

    await expect(
      service.updateRole(actor({ email: 'someone-else@example.com' }), {
        provider: 'deep-id',
        email: 'last-owner@example.com',
        role: 'admin',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('updateRole promotes an admin to owner', async () => {
    const service = createService();
    const acting = actor({ email: 'owner@example.com' });
    adminAllowlistRepository.findActiveByProviderEmail.mockResolvedValue({
      _id: new Types.ObjectId(),
      provider: 'deep-id',
      email: 'admin@example.com',
      role: 'admin',
      invitedAt: new Date(),
    });
    adminAllowlistRepository.updateRole.mockResolvedValue({
      _id: new Types.ObjectId(),
      provider: 'deep-id',
      email: 'admin@example.com',
      role: 'owner',
      invitedAt: new Date(),
    });
    oauthUserRepository.findByIds.mockResolvedValue([]);

    const view = await service.updateRole(acting, { provider: 'deep-id', email: 'admin@example.com', role: 'owner' });

    expect(view.role).toBe('owner');
    expect(adminAllowlistRepository.updateRole).toHaveBeenCalledWith('deep-id', 'admin@example.com', 'owner');
  });

  it('removeAdmin forbids self-removal', async () => {
    const service = createService();
    const acting = actor({ email: 'owner@example.com' });

    await expect(
      service.removeAdmin(acting, { provider: 'deep-id', email: 'owner@example.com' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('removeAdmin forbids removing the last owner', async () => {
    const service = createService();
    adminAllowlistRepository.findActiveByProviderEmail.mockResolvedValue({
      _id: new Types.ObjectId(),
      provider: 'deep-id',
      email: 'last-owner@example.com',
      role: 'owner',
      invitedAt: new Date(),
    });
    adminAllowlistRepository.countActiveOwners.mockResolvedValue(1);

    await expect(
      service.removeAdmin(actor({ email: 'someone-else@example.com' }), {
        provider: 'deep-id',
        email: 'last-owner@example.com',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('seedOwner creates the configured owner when none exist', async () => {
    const service = createService('owner@example.com');
    adminAllowlistRepository.findByProviderEmail.mockResolvedValue(null);

    await service.seedOwner();

    expect(adminAllowlistRepository.createAdmin).toHaveBeenCalledWith('deep-id', 'owner@example.com', 'owner', null);
  });

  it('seedOwner is idempotent when configured owner already active', async () => {
    const service = createService('owner@example.com');
    adminAllowlistRepository.findByProviderEmail.mockResolvedValue({
      _id: new Types.ObjectId(),
      provider: 'deep-id',
      email: 'owner@example.com',
      role: 'owner',
      invitedAt: new Date(),
    });

    await service.seedOwner();

    expect(adminAllowlistRepository.createAdmin).not.toHaveBeenCalled();
    expect(adminAllowlistRepository.restore).not.toHaveBeenCalled();
  });

  it('seedOwner restores a revoked owner row to owner', async () => {
    const service = createService('owner@example.com');
    adminAllowlistRepository.findByProviderEmail.mockResolvedValue({
      _id: new Types.ObjectId(),
      provider: 'deep-id',
      email: 'owner@example.com',
      role: 'admin',
      invitedAt: new Date(),
      revokedAt: new Date(),
    });

    await service.seedOwner();

    expect(adminAllowlistRepository.restore).toHaveBeenCalledWith('deep-id', 'owner@example.com', null, {
      role: 'owner',
    });
  });

  it('seedOwner throws when configured owner email is held by an active non-owner row', async () => {
    const loggerFatalSpy = vi.spyOn(Logger.prototype, 'fatal').mockImplementation(() => undefined);
    const service = createService('owner@example.com');
    adminAllowlistRepository.findByProviderEmail.mockResolvedValue({
      _id: new Types.ObjectId(),
      provider: 'deep-id',
      email: 'owner@example.com',
      role: 'admin',
      invitedAt: new Date(),
    });

    await expect(service.seedOwner()).rejects.toThrow(OwnerEmailConflictError);
    expect(loggerFatalSpy).toHaveBeenCalled();
    loggerFatalSpy.mockRestore();
  });

  it('seedOwner skips when OWNER_EMAIL is not configured', async () => {
    const service = createService(undefined);

    await service.seedOwner();

    expect(adminAllowlistRepository.findByProviderEmail).not.toHaveBeenCalled();
    expect(adminAllowlistRepository.createAdmin).not.toHaveBeenCalled();
  });
});
