import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRoundsRepo } from '../../../../src/resources/rounds/repository.js';
import type { DeepFundingPortalDb } from '../../../../src/shared/types/db.js';
import { cleanupTestDb, createTestDb } from '../../../utils/db-helpers.js';
import { createMockRound } from '../../../utils/mock-helpers.js';

describe('Round Repository', () => {
  let db: DeepFundingPortalDb;
  let repo: ReturnType<typeof createRoundsRepo>;

  beforeEach(async () => {
    db = await createTestDb();
    repo = createRoundsRepo(db);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  describe('create', () => {
    it('should insert a single round', async () => {
      const round = createMockRound({
        id: 1,
        name: 'Test Round',
      });

      await repo.create(round);

      const result = await repo.findById(1);
      expect(result).toBeDefined();
      expect(result?.name).toBe('Test Round');
    });
  });

  describe('createMany', () => {
    it('should insert multiple rounds', async () => {
      const rounds = [createMockRound({ id: 1 }), createMockRound({ id: 2 }), createMockRound({ id: 3 })];

      await repo.createMany(rounds);

      const all = await repo.findAll();
      expect(all.length).toBe(3);
    });
  });

  describe('findAll', () => {
    it('should return all rounds', async () => {
      await repo.create(createMockRound({ id: 1 }));
      await repo.create(createMockRound({ id: 2 }));

      const result = await repo.findAll();
      expect(result.length).toBe(2);
    });
  });

  describe('findById', () => {
    it('should find round by ID', async () => {
      const round = createMockRound({
        id: 1,
        name: 'Specific Round',
      });
      await repo.create(round);

      const result = await repo.findById(1);
      expect(result).toBeDefined();
      expect(result?.id).toBe(1);
      expect(result?.name).toBe('Specific Round');
    });
  });
});
