import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUsersRepo } from '../../../../src/resources/users/repository.js';
import type { DeepFundingPortalDb } from '../../../../src/shared/types/db.js';
import { cleanupTestDb, createTestDb } from '../../../utils/db-helpers.js';
import { createMockUser } from '../../../utils/mock-helpers.js';

describe('User Repository', () => {
  let db: DeepFundingPortalDb;
  let repo: ReturnType<typeof createUsersRepo>;

  beforeEach(async () => {
    db = await createTestDb();
    repo = createUsersRepo(db);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  describe('create', () => {
    it('should insert a single user', async () => {
      const user = createMockUser({
        id: 1,
        user_name: 'testuser',
      });

      await repo.create(user);

      const result = await repo.findById(1);
      expect(result).toBeDefined();
      expect(result?.userName).toBe('testuser');
    });
  });

  describe('createMany', () => {
    it('should insert multiple users', async () => {
      const users = [createMockUser({ id: 1 }), createMockUser({ id: 2 }), createMockUser({ id: 3 })];

      await repo.createMany(users);

      const all = await repo.findAll();
      expect(all.length).toBe(3);
    });
  });

  describe('findAll', () => {
    it('should return all users', async () => {
      await repo.create(createMockUser({ id: 1 }));
      await repo.create(createMockUser({ id: 2 }));

      const result = await repo.findAll();
      expect(result.length).toBe(2);
    });
  });

  describe('findById', () => {
    it('should find user by ID', async () => {
      const user = createMockUser({
        id: 1,
        user_name: 'specificuser',
      });
      await repo.create(user);

      const result = await repo.findById(1);
      expect(result).toBeDefined();
      expect(result?.id).toBe(1);
      expect(result?.userName).toBe('specificuser');
    });

    it('should return undefined when user not found', async () => {
      const result = await repo.findById(999);
      expect(result).toBeUndefined();
    });
  });
});
