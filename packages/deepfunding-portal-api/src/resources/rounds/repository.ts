import { RoundEntity } from '../../db/entities/round.entity.js';
import type { DeepFundingPortalDb } from '../../shared/types/db.js';
import { type CreateManyOptions, chunkArray, DEFAULT_CHUNK_SIZE } from '../../shared/utils/index.js';
import { normalizeRoundToRecord } from './normalize.js';
import type { Round, RoundRecord } from './types.js';

/**
 * Create a rounds repository bound to the given database instance.
 */
export function createRoundsRepo(db: DeepFundingPortalDb) {
  const repo = db.dataSource.getRepository(RoundEntity);

  return {
    async create(data: Round): Promise<void> {
      await repo.insert(normalizeRoundToRecord(data));
    },

    async createMany(items: Round[], options?: CreateManyOptions): Promise<void> {
      const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
      const chunks = chunkArray(items, chunkSize);
      await db.dataSource.transaction(async (manager) => {
        const txRepo = manager.getRepository(RoundEntity);
        for (const chunk of chunks) {
          await txRepo.insert(chunk.map(normalizeRoundToRecord));
        }
      });
    },

    async findAll(): Promise<RoundRecord[]> {
      return (await repo.find()) as unknown as RoundRecord[];
    },

    async findById(id: number): Promise<RoundRecord | undefined> {
      const result = (await repo.findOne({ where: { id } })) as unknown as RoundRecord | null;
      return result ?? undefined;
    },
  };
}

export type RoundsRepo = ReturnType<typeof createRoundsRepo>;
