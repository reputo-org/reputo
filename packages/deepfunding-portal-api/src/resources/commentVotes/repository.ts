import { CommentVoteEntity } from '../../db/entities/comment-vote.entity.js';
import type { DeepFundingPortalDb } from '../../shared/types/db.js';
import { type CreateManyOptions, chunkArray, DEFAULT_CHUNK_SIZE } from '../../shared/utils/index.js';
import { normalizeCommentVoteToRecord } from './normalize.js';
import type { CommentVote, CommentVoteRecord } from './types.js';

/**
 * Create a comment-votes repository bound to the given database instance.
 */
export function createCommentVotesRepo(db: DeepFundingPortalDb) {
  const repo = db.dataSource.getRepository(CommentVoteEntity);

  return {
    async create(data: CommentVote): Promise<void> {
      await repo.insert(normalizeCommentVoteToRecord(data));
    },

    async createMany(items: CommentVote[], options?: CreateManyOptions): Promise<void> {
      const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
      const chunks = chunkArray(items, chunkSize);
      await db.dataSource.transaction(async (manager) => {
        const txRepo = manager.getRepository(CommentVoteEntity);
        for (const chunk of chunks) {
          await txRepo.insert(chunk.map(normalizeCommentVoteToRecord));
        }
      });
    },

    async findAll(): Promise<CommentVoteRecord[]> {
      return (await repo.find()) as unknown as CommentVoteRecord[];
    },

    async findByCommentId(commentId: number): Promise<CommentVoteRecord[]> {
      return (await repo.find({ where: { commentId } })) as unknown as CommentVoteRecord[];
    },

    async findByVoterId(voterId: number): Promise<CommentVoteRecord[]> {
      return (await repo.find({ where: { voterId } })) as unknown as CommentVoteRecord[];
    },
  };
}

export type CommentVotesRepo = ReturnType<typeof createCommentVotesRepo>;
