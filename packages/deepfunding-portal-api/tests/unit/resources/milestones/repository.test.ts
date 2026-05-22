import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMilestonesRepo } from '../../../../src/resources/milestones/repository.js';
import type { DeepFundingPortalDb } from '../../../../src/shared/types/db.js';
import { cleanupTestDb, createTestDb } from '../../../utils/db-helpers.js';
import { createMockMilestone } from '../../../utils/mock-helpers.js';

describe('Milestone Repository', () => {
  let db: DeepFundingPortalDb;
  let repo: ReturnType<typeof createMilestonesRepo>;

  beforeEach(async () => {
    db = await createTestDb();
    repo = createMilestonesRepo(db);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  describe('create', () => {
    it('should insert a single milestone', async () => {
      const milestone = createMockMilestone({
        id: 1,
        proposal_id: 100,
        title: 'Test Milestone',
      });

      await repo.create(milestone);

      const all = await repo.findAll();
      const first = all[0];
      expect(first).toBeDefined();
      expect(first?.title).toBe('Test Milestone');
      expect(first?.proposalId).toBe(100);
    });
  });

  describe('createMany', () => {
    it('should insert multiple milestones', async () => {
      const milestones = [
        createMockMilestone({ id: 1, proposal_id: 100 }),
        createMockMilestone({ id: 2, proposal_id: 100 }),
        createMockMilestone({ id: 3, proposal_id: 200 }),
      ];

      await repo.createMany(milestones);

      const all = await repo.findAll();
      expect(all.length).toBe(3);
    });

    it('should handle chunking for large batches', async () => {
      const milestones = Array.from({ length: 250 }, (_, i) =>
        createMockMilestone({
          id: i + 1,
          proposal_id: 100,
        }),
      );

      await repo.createMany(milestones, { chunkSize: 100 });

      const all = await repo.findAll();
      expect(all.length).toBe(250);
    });

    it('should use default chunk size when not specified', async () => {
      const milestones = Array.from({ length: 150 }, (_, i) =>
        createMockMilestone({
          id: i + 1,
          proposal_id: 100,
        }),
      );

      await repo.createMany(milestones);

      const all = await repo.findAll();
      expect(all.length).toBe(150);
    });
  });

  describe('findAll', () => {
    it('should return all milestones', async () => {
      await repo.create(createMockMilestone({ id: 1, proposal_id: 100 }));
      await repo.create(createMockMilestone({ id: 2, proposal_id: 200 }));

      const result = await repo.findAll();
      expect(result.length).toBe(2);
    });

    it('should return empty array when no milestones exist', async () => {
      const result = await repo.findAll();
      expect(result).toEqual([]);
    });
  });

  describe('findByProposalId', () => {
    it('should find milestones by proposal ID', async () => {
      await repo.create(createMockMilestone({ id: 1, proposal_id: 100 }));
      await repo.create(createMockMilestone({ id: 2, proposal_id: 100 }));
      await repo.create(createMockMilestone({ id: 3, proposal_id: 200 }));

      const result = await repo.findByProposalId(100);
      expect(result.length).toBe(2);
      expect(result.every((m) => m.proposalId === 100)).toBe(true);
    });

    it('should return empty array when no milestones found for proposal', async () => {
      const result = await repo.findByProposalId(999);
      expect(result).toEqual([]);
    });
  });

  describe('findById', () => {
    it('should find milestone by ID', async () => {
      const milestone = createMockMilestone({
        id: 1,
        proposal_id: 100,
        title: 'Specific Milestone',
      });
      await repo.create(milestone);

      const all = await repo.findAll();
      const first = all[0];
      expect(first).toBeDefined();
      if (!first) return;

      const result = await repo.findById(first.id);
      expect(result).toBeDefined();
      expect(result?.id).toBe(first.id);
      expect(result?.title).toBe('Specific Milestone');
    });

    it('should return undefined when milestone not found', async () => {
      const result = await repo.findById(999);
      expect(result).toBeUndefined();
    });
  });
});
