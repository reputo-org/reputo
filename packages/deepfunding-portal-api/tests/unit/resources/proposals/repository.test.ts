import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProposalsRepo } from '../../../../src/resources/proposals/repository.js';
import type { DeepFundingPortalDb } from '../../../../src/shared/types/db.js';
import { cleanupTestDb, createTestDb } from '../../../utils/db-helpers.js';
import { createMockProposal } from '../../../utils/mock-helpers.js';

describe('Proposal Repository', () => {
  let db: DeepFundingPortalDb;
  let repo: ReturnType<typeof createProposalsRepo>;

  beforeEach(async () => {
    db = await createTestDb();
    repo = createProposalsRepo(db);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  describe('create', () => {
    it('should insert a single proposal', async () => {
      const proposal = createMockProposal({
        id: 1,
        round_id: 10,
        title: 'Test Proposal',
      });

      await repo.create(proposal);

      const result = await repo.findById(1);
      expect(result).toBeDefined();
      expect(result?.title).toBe('Test Proposal');
      expect(result?.roundId).toBe(10);
    });
  });

  describe('createMany', () => {
    it('should insert multiple proposals', async () => {
      const proposals = [
        createMockProposal({ id: 1, round_id: 10 }),
        createMockProposal({ id: 2, round_id: 10 }),
        createMockProposal({ id: 3, round_id: 20 }),
      ];

      await repo.createMany(proposals);

      const all = await repo.findAll();
      expect(all.length).toBe(3);
    });

    it('should handle chunking for large batches', async () => {
      const proposals = Array.from({ length: 250 }, (_, i) =>
        createMockProposal({
          id: i + 1,
          round_id: 10,
        }),
      );

      await repo.createMany(proposals, { chunkSize: 100 });

      const all = await repo.findAll();
      expect(all.length).toBe(250);
    });
  });

  describe('findAll', () => {
    it('should return all proposals', async () => {
      await repo.create(createMockProposal({ id: 1, round_id: 10 }));
      await repo.create(createMockProposal({ id: 2, round_id: 20 }));

      const result = await repo.findAll();
      expect(result.length).toBe(2);
    });

    it('should return empty array when no proposals exist', async () => {
      const result = await repo.findAll();
      expect(result).toEqual([]);
    });
  });

  describe('findByRoundId', () => {
    it('should find proposals by round ID', async () => {
      await repo.create(createMockProposal({ id: 1, round_id: 10 }));
      await repo.create(createMockProposal({ id: 2, round_id: 10 }));
      await repo.create(createMockProposal({ id: 3, round_id: 20 }));

      const result = await repo.findByRoundId(10);
      expect(result.length).toBe(2);
      expect(result.every((p) => p.roundId === 10)).toBe(true);
    });

    it('should return empty array when no proposals found for round', async () => {
      const result = await repo.findByRoundId(999);
      expect(result).toEqual([]);
    });
  });

  describe('findById', () => {
    it('should find proposal by ID', async () => {
      const proposal = createMockProposal({
        id: 1,
        round_id: 10,
        title: 'Specific Proposal',
      });
      await repo.create(proposal);

      const result = await repo.findById(1);
      expect(result).toBeDefined();
      expect(result?.id).toBe(1);
      expect(result?.title).toBe('Specific Proposal');
    });

    it('should return undefined when proposal not found', async () => {
      const result = await repo.findById(999);
      expect(result).toBeUndefined();
    });
  });
});
