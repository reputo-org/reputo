import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import AccessAllowlistModel from '../../../src/models/AccessAllowlist.model.js';
import {
  ACCESS_ROLE_ADMIN,
  ACCESS_ROLE_OWNER,
  ACCESS_ROLES,
  MODEL_NAMES,
  OAuthProviderDeepId,
} from '../../../src/shared/constants/index.js';
import type { AccessAllowlist, AccessAllowlistWithId } from '../../../src/shared/types/index.js';

describe('AccessAllowlist model', () => {
  let mongo: MongoMemoryServer | undefined;

  const createAllowlistEntry = (overrides: Partial<AccessAllowlist> = {}): AccessAllowlist => ({
    provider: OAuthProviderDeepId,
    email: 'owner@example.com',
    role: ACCESS_ROLE_OWNER,
    invitedAt: new Date('2026-05-01T00:00:00.000Z'),
    ...overrides,
  });

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
    await AccessAllowlistModel.init();
  });

  beforeEach(async () => {
    await AccessAllowlistModel.deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo?.stop();
  });

  describe('AccessAllowlist validation', () => {
    test('should normalize email before validation and persistence', async () => {
      const doc = new AccessAllowlistModel(createAllowlistEntry({ email: '  Foo@Example.COM  ' }));

      await expect(doc.validate()).resolves.toBeUndefined();
      expect(doc.email).toBe('foo@example.com');

      const persisted = await AccessAllowlistModel.create(createAllowlistEntry({ email: '  Admin@Example.COM  ' }));
      expect(persisted.email).toBe('admin@example.com');
    });

    test('should reject empty email values after trimming', async () => {
      const doc = new AccessAllowlistModel(createAllowlistEntry({ email: '   ' }));

      await expect(doc.validate()).rejects.toThrow(/email/i);
    });

    test('should allow invitedBy to round-trip through lean reads', async () => {
      const invitedBy = new Types.ObjectId();
      const created = await AccessAllowlistModel.create(
        createAllowlistEntry({
          email: 'admin@example.com',
          role: ACCESS_ROLE_ADMIN,
          invitedBy,
        }),
      );

      const read = await AccessAllowlistModel.findById(created._id).lean<AccessAllowlistWithId>();

      expect(read?.invitedBy?.toString()).toBe(invitedBy.toString());
    });
  });

  describe('AccessAllowlist immutability', () => {
    test('should keep provider and email immutable after insert', async () => {
      const created = await AccessAllowlistModel.create(createAllowlistEntry({ email: 'owner@example.com' }));

      await AccessAllowlistModel.updateOne(
        { _id: created._id },
        { $set: { provider: 'other-provider', email: 'other@example.com' } },
      );

      const read = await AccessAllowlistModel.findById(created._id).lean<AccessAllowlistWithId>();
      expect(read?.provider).toBe(OAuthProviderDeepId);
      expect(read?.email).toBe('owner@example.com');
    });
  });

  describe('AccessAllowlist indexes', () => {
    test('should define the unique provider and email compound index', () => {
      const indexes = AccessAllowlistModel.schema.indexes();
      const providerEmailIndex = indexes.find(([fields]) => fields.provider === 1 && fields.email === 1);

      expect(providerEmailIndex?.[1]).toMatchObject({ unique: true });
    });

    test('should define a non-unique revokedAt index', () => {
      const indexes = AccessAllowlistModel.schema.indexes();
      const revokedAtIndex = indexes.find(([fields]) => fields.revokedAt === 1);

      expect(revokedAtIndex).toBeDefined();
      expect(revokedAtIndex?.[1]).not.toMatchObject({ unique: true });
    });

    test('should reject case-variant duplicate emails for the same provider', async () => {
      await AccessAllowlistModel.create(createAllowlistEntry({ email: 'Foo@x.com' }));

      await expect(
        AccessAllowlistModel.create(createAllowlistEntry({ email: 'foo@x.com', role: ACCESS_ROLE_ADMIN })),
      ).rejects.toHaveProperty('code', 11000);
    });
  });

  describe('AccessAllowlist soft revoke', () => {
    test('should persist revoke metadata and support active-only listing', async () => {
      const active = await AccessAllowlistModel.create(createAllowlistEntry({ email: 'active@example.com' }));
      const revokedBy = new Types.ObjectId();
      const revokedAt = new Date('2026-05-02T12:00:00.000Z');
      const revoked = await AccessAllowlistModel.create(
        createAllowlistEntry({
          email: 'revoked@example.com',
          role: ACCESS_ROLE_ADMIN,
        }),
      );

      revoked.set({ revokedAt, revokedBy });
      await revoked.save();

      const read = await AccessAllowlistModel.findById(revoked._id).lean<AccessAllowlistWithId>();
      expect(read?.revokedAt).toEqual(revokedAt);
      expect(read?.revokedBy?.toString()).toBe(revokedBy.toString());

      const activeRows = await AccessAllowlistModel.find({ revokedAt: null }).lean<AccessAllowlistWithId[]>();
      expect(activeRows).toHaveLength(1);
      expect(activeRows[0]?._id.toString()).toBe(active._id.toString());
    });
  });

  describe('AccessAllowlist exports', () => {
    test('should be registered with the correct model name', () => {
      expect(AccessAllowlistModel.modelName).toBe(MODEL_NAMES.ACCESS_ALLOWLIST);
    });

    test('should use the AccessAllowlistSchema', () => {
      expect(AccessAllowlistModel.schema).toBeDefined();
      expect(AccessAllowlistModel.schema.path('provider')).toBeDefined();
      expect(AccessAllowlistModel.schema.path('email')).toBeDefined();
      expect(AccessAllowlistModel.schema.path('role')).toBeDefined();
    });

    test('should re-export through the models barrel', async () => {
      const models = await import('../../../src/models/index.js');
      expect(models.AccessAllowlistModel).toBe(AccessAllowlistModel);
    });

    test('should re-export through the package barrel', async () => {
      const pkg = await import('../../../src/index.js');
      expect(pkg.AccessAllowlistModel).toBe(AccessAllowlistModel);
      expect(pkg.AccessAllowlistModelValue).toBe(AccessAllowlistModel);
    });

    test('should re-export constants and schema through public barrels', async () => {
      const pkg = await import('../../../src/index.js');

      expect(pkg.AccessAllowlistSchema).toBe(AccessAllowlistModel.schema);
      expect(pkg.ACCESS_ROLE_OWNER).toBe('owner');
      expect(pkg.ACCESS_ROLE_ADMIN).toBe('admin');
      expect(pkg.ACCESS_ROLES).toEqual(ACCESS_ROLES);
      expect(pkg.MODEL_NAMES.ACCESS_ALLOWLIST).toBe('AccessAllowlist');
    });
  });
});
