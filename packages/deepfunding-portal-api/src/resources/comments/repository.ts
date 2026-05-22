import { CommentEntity } from '../../db/entities/comment.entity.js';
import type { DeepFundingPortalDb } from '../../shared/types/db.js';
import { type CreateManyOptions, chunkArray, DEFAULT_CHUNK_SIZE } from '../../shared/utils/index.js';
import { normalizeCommentToRecord } from './normalize.js';
import type { Comment, CommentRecord } from './types.js';

/**
 * Create a comments repository bound to the given database instance.
 */
export function createCommentsRepo(db: DeepFundingPortalDb) {
  const repo = db.dataSource.getRepository(CommentEntity);

  return {
    async create(data: Comment): Promise<void> {
      await repo.insert(normalizeCommentToRecord(data));
    },

    async createMany(items: Comment[], options?: CreateManyOptions): Promise<void> {
      const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
      const chunks = chunkArray(items, chunkSize);
      await db.dataSource.transaction(async (manager) => {
        const txRepo = manager.getRepository(CommentEntity);
        for (const chunk of chunks) {
          await txRepo.insert(chunk.map(normalizeCommentToRecord));
        }
      });
    },

    async findAll(): Promise<CommentRecord[]> {
      return (await repo.find()) as unknown as CommentRecord[];
    },

    async findByProposalId(proposalId: number): Promise<CommentRecord[]> {
      return (await repo.find({ where: { proposalId } })) as unknown as CommentRecord[];
    },

    async findByUserId(userId: number): Promise<CommentRecord[]> {
      return (await repo.find({ where: { userId } })) as unknown as CommentRecord[];
    },

    async findById(commentId: number): Promise<CommentRecord | undefined> {
      const result = (await repo.findOne({ where: { commentId } })) as unknown as CommentRecord | null;
      return result ?? undefined;
    },
  };
}

export type CommentsRepo = ReturnType<typeof createCommentsRepo>;
