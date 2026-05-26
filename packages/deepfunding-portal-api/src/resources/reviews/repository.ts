import { ReviewEntity } from '../../db/entities/review.entity.js';
import type { DeepFundingPortalDb } from '../../shared/types/db.js';
import { type CreateManyOptions, chunkArray, DEFAULT_CHUNK_SIZE } from '../../shared/utils/index.js';
import { normalizeReviewToRecord } from './normalize.js';
import type { Review, ReviewRecord } from './types.js';

export function createReviewsRepo(db: DeepFundingPortalDb) {
  const repo = db.dataSource.getRepository(ReviewEntity);

  return {
    async create(data: Review): Promise<void> {
      await repo.insert(normalizeReviewToRecord(data));
    },

    async createMany(items: Review[], options?: CreateManyOptions): Promise<void> {
      const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
      const chunks = chunkArray(items, chunkSize);
      await db.dataSource.transaction(async (manager) => {
        const txRepo = manager.getRepository(ReviewEntity);
        for (const chunk of chunks) {
          await txRepo.insert(chunk.map(normalizeReviewToRecord));
        }
      });
    },

    async findAll(): Promise<ReviewRecord[]> {
      return (await repo.find()) as unknown as ReviewRecord[];
    },

    async findByProposalId(proposalId: number): Promise<ReviewRecord[]> {
      return (await repo.find({ where: { proposalId } })) as unknown as ReviewRecord[];
    },

    async findByReviewerId(reviewerId: number): Promise<ReviewRecord[]> {
      return (await repo.find({ where: { reviewerId } })) as unknown as ReviewRecord[];
    },

    async findById(reviewId: number): Promise<ReviewRecord | undefined> {
      const result = (await repo.findOne({ where: { reviewId } })) as unknown as ReviewRecord | null;
      return result ?? undefined;
    },
  };
}

export type ReviewsRepo = ReturnType<typeof createReviewsRepo>;
