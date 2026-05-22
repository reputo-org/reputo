import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createReviewsRepo } from '../../../../src/resources/reviews/repository.js';
import type { DeepFundingPortalDb } from '../../../../src/shared/types/db.js';
import { cleanupTestDb, createTestDb } from '../../../utils/db-helpers.js';
import { createMockReview } from '../../../utils/mock-helpers.js';

describe('Review Repository', () => {
  let db: DeepFundingPortalDb;
  let repo: ReturnType<typeof createReviewsRepo>;

  beforeEach(async () => {
    db = await createTestDb();
    repo = createReviewsRepo(db);
  });

  afterEach(async () => {
    await cleanupTestDb(db);
  });

  describe('create', () => {
    it('should insert a single review', async () => {
      const review = createMockReview({
        proposal_id: 100,
        reviewer_id: 10,
      });

      await repo.create(review);

      const all = await repo.findAll();
      expect(all.length).toBe(1);
      expect(all[0]?.proposalId).toBe(100);
      expect(all[0]?.reviewerId).toBe(10);
    });
  });

  describe('createMany', () => {
    it('should insert multiple reviews', async () => {
      const reviews = [
        createMockReview({ proposal_id: 100, reviewer_id: 10 }),
        createMockReview({ proposal_id: 100, reviewer_id: 20 }),
        createMockReview({ proposal_id: 200, reviewer_id: 10 }),
      ];

      await repo.createMany(reviews);

      const all = await repo.findAll();
      expect(all.length).toBe(3);
    });
  });

  describe('findAll', () => {
    it('should return all reviews', async () => {
      await repo.create(createMockReview({ proposal_id: 100 }));
      await repo.create(createMockReview({ proposal_id: 200 }));

      const result = await repo.findAll();
      expect(result.length).toBe(2);
    });
  });

  describe('findByProposalId', () => {
    it('should find reviews by proposal ID', async () => {
      await repo.create(createMockReview({ proposal_id: 100, reviewer_id: 10 }));
      await repo.create(createMockReview({ proposal_id: 100, reviewer_id: 20 }));
      await repo.create(createMockReview({ proposal_id: 200, reviewer_id: 10 }));

      const result = await repo.findByProposalId(100);
      expect(result.length).toBe(2);
      expect(result.every((r) => r.proposalId === 100)).toBe(true);
    });
  });

  describe('findByReviewerId', () => {
    it('should find reviews by reviewer ID', async () => {
      await repo.create(createMockReview({ proposal_id: 100, reviewer_id: 10 }));
      await repo.create(createMockReview({ proposal_id: 200, reviewer_id: 10 }));
      await repo.create(createMockReview({ proposal_id: 300, reviewer_id: 20 }));

      const result = await repo.findByReviewerId(10);
      expect(result.length).toBe(2);
      expect(result.every((r) => r.reviewerId === 10)).toBe(true);
    });
  });

  describe('findById', () => {
    it('should find review by ID', async () => {
      const review = createMockReview({
        proposal_id: 100,
        review_type: 'expert',
      });
      await repo.create(review);

      const all = await repo.findAll();
      const firstReview = all[0];
      if (firstReview) {
        const result = await repo.findById(firstReview.reviewId);
        expect(result).toBeDefined();
        expect(result?.reviewId).toBe(firstReview.reviewId);
        expect(result?.reviewType).toBe('expert');
      }
    });
  });
});
