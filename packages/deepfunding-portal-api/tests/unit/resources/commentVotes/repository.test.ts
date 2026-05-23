import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCommentVotesRepo } from '../../../../src/resources/commentVotes/repository.js';
import type { DeepFundingPortalDb } from '../../../../src/shared/types/db.js';
import { cleanupTestDb, createTestDb } from '../../../utils/db-helpers.js';
import { createMockCommentVote } from '../../../utils/mock-helpers.js';

describe('CommentVote Repository', () => {
  let db: DeepFundingPortalDb;
  let repo: ReturnType<typeof createCommentVotesRepo>;

  beforeEach(async () => {
    db = await createTestDb();
    repo = createCommentVotesRepo(db);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  describe('create', () => {
    it('should insert a single comment vote', async () => {
      const vote = createMockCommentVote({
        voter_id: 1,
        comment_id: 10,
      });

      await repo.create(vote);

      const all = await repo.findAll();
      expect(all.length).toBe(1);
      expect(all[0]?.voterId).toBe(1);
      expect(all[0]?.commentId).toBe(10);
    });
  });

  describe('createMany', () => {
    it('should insert multiple comment votes', async () => {
      const votes = [
        createMockCommentVote({ voter_id: 1, comment_id: 10 }),
        createMockCommentVote({ voter_id: 2, comment_id: 10 }),
        createMockCommentVote({ voter_id: 1, comment_id: 20 }),
      ];

      await repo.createMany(votes);

      const all = await repo.findAll();
      expect(all.length).toBe(3);
    });
  });

  describe('findAll', () => {
    it('should return all comment votes', async () => {
      await repo.create(createMockCommentVote({ voter_id: 1, comment_id: 10 }));
      await repo.create(createMockCommentVote({ voter_id: 2, comment_id: 20 }));

      const result = await repo.findAll();
      expect(result.length).toBe(2);
    });
  });

  describe('findByCommentId', () => {
    it('should find votes by comment ID', async () => {
      await repo.create(createMockCommentVote({ voter_id: 1, comment_id: 10 }));
      await repo.create(createMockCommentVote({ voter_id: 2, comment_id: 10 }));
      await repo.create(createMockCommentVote({ voter_id: 3, comment_id: 20 }));

      const result = await repo.findByCommentId(10);
      expect(result.length).toBe(2);
      expect(result.every((v) => v.commentId === 10)).toBe(true);
    });
  });

  describe('findByVoterId', () => {
    it('should find votes by voter ID', async () => {
      await repo.create(createMockCommentVote({ voter_id: 1, comment_id: 10 }));
      await repo.create(createMockCommentVote({ voter_id: 1, comment_id: 20 }));
      await repo.create(createMockCommentVote({ voter_id: 2, comment_id: 30 }));

      const result = await repo.findByVoterId(1);
      expect(result.length).toBe(2);
      expect(result.every((v) => v.voterId === 1)).toBe(true);
    });
  });
});
