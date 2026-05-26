import { PoolEntity } from '../../db/entities/pool.entity.js';
import type { DeepFundingPortalDb } from '../../shared/types/db.js';
import { type CreateManyOptions, chunkArray, DEFAULT_CHUNK_SIZE } from '../../shared/utils/index.js';
import { normalizePoolToRecord } from './normalize.js';
import type { Pool, PoolRecord } from './types.js';

export function createPoolsRepo(db: DeepFundingPortalDb) {
  const repo = db.dataSource.getRepository(PoolEntity);

  return {
    async create(data: Pool): Promise<void> {
      await repo.insert(normalizePoolToRecord(data));
    },

    async createMany(items: Pool[], options?: CreateManyOptions): Promise<void> {
      const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
      const chunks = chunkArray(items, chunkSize);
      await db.dataSource.transaction(async (manager) => {
        const txRepo = manager.getRepository(PoolEntity);
        for (const chunk of chunks) {
          await txRepo.insert(chunk.map(normalizePoolToRecord));
        }
      });
    },

    async findAll(): Promise<PoolRecord[]> {
      return (await repo.find()) as unknown as PoolRecord[];
    },

    async findById(id: number): Promise<PoolRecord | undefined> {
      const result = (await repo.findOne({ where: { id } })) as unknown as PoolRecord | null;
      return result ?? undefined;
    },
  };
}

export type PoolsRepo = ReturnType<typeof createPoolsRepo>;
