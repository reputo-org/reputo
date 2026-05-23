import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCommentsRepo } from '../../../../src/resources/comments/repository.js';
import type { DeepFundingPortalDb } from '../../../../src/shared/types/db.js';
import { cleanupTestDb, createTestDb } from '../../../utils/db-helpers.js';
import { createMockComment } from '../../../utils/mock-helpers.js';

describe('Comment Repository', () => {
  let db: DeepFundingPortalDb;
  let repo: ReturnType<typeof createCommentsRepo>;

  beforeEach(async () => {
    db = await createTestDb();
    repo = createCommentsRepo(db);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  describe('create', () => {
    it('should insert a single comment', async () => {
      const comment = createMockComment({
        comment_id: 1,
        proposal_id: 100,
      });

      await repo.create(comment);

      const result = await repo.findById(1);
      expect(result).toBeDefined();
      expect(result?.proposalId).toBe(100);
    });
  });

  describe('createMany', () => {
    it('should insert multiple comments', async () => {
      const comments = [
        createMockComment({ comment_id: 1, proposal_id: 100 }),
        createMockComment({ comment_id: 2, proposal_id: 100 }),
        createMockComment({ comment_id: 3, proposal_id: 200 }),
      ];

      await repo.createMany(comments);

      const all = await repo.findAll();
      expect(all.length).toBe(3);
    });
  });

  describe('findAll', () => {
    it('should return all comments', async () => {
      await repo.create(createMockComment({ comment_id: 1 }));
      await repo.create(createMockComment({ comment_id: 2 }));

      const result = await repo.findAll();
      expect(result.length).toBe(2);
    });
  });

  describe('findByProposalId', () => {
    it('should find comments by proposal ID', async () => {
      await repo.create(createMockComment({ comment_id: 1, proposal_id: 100 }));
      await repo.create(createMockComment({ comment_id: 2, proposal_id: 100 }));
      await repo.create(createMockComment({ comment_id: 3, proposal_id: 200 }));

      const result = await repo.findByProposalId(100);
      expect(result.length).toBe(2);
      expect(result.every((c) => c.proposalId === 100)).toBe(true);
    });
  });

  describe('findByUserId', () => {
    it('should find comments by user ID', async () => {
      await repo.create(createMockComment({ comment_id: 1, user_id: 10 }));
      await repo.create(createMockComment({ comment_id: 2, user_id: 10 }));
      await repo.create(createMockComment({ comment_id: 3, user_id: 20 }));

      const result = await repo.findByUserId(10);
      expect(result.length).toBe(2);
      expect(result.every((c) => c.userId === 10)).toBe(true);
    });
  });

  describe('findById', () => {
    it('should find comment by ID', async () => {
      const comment = createMockComment({
        comment_id: 1,
        content: 'Specific comment',
      });
      await repo.create(comment);

      const result = await repo.findById(1);
      expect(result).toBeDefined();
      expect(result?.commentId).toBe(1);
      expect(result?.content).toBe('Specific comment');
    });
  });
});
