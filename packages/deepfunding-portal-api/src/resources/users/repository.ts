import { UserEntity } from '../../db/entities/user.entity.js';
import type { DeepFundingPortalDb } from '../../shared/types/db.js';
import { type CreateManyOptions, chunkArray, DEFAULT_CHUNK_SIZE } from '../../shared/utils/index.js';
import { normalizeUserToRecord } from './normalize.js';
import type { User, UserRecord } from './types.js';

/**
 * Create a users repository bound to the given database instance.
 */
export function createUsersRepo(db: DeepFundingPortalDb) {
  const repo = db.dataSource.getRepository(UserEntity);

  return {
    async create(data: User): Promise<void> {
      await repo.insert(normalizeUserToRecord(data));
    },

    async createMany(items: User[], options?: CreateManyOptions): Promise<void> {
      const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
      const chunks = chunkArray(items, chunkSize);
      await db.dataSource.transaction(async (manager) => {
        const txRepo = manager.getRepository(UserEntity);
        for (const chunk of chunks) {
          await txRepo.insert(chunk.map(normalizeUserToRecord));
        }
      });
    },

    async findAll(): Promise<UserRecord[]> {
      return (await repo.find()) as unknown as UserRecord[];
    },

    async findById(id: number): Promise<UserRecord | undefined> {
      const result = (await repo.findOne({ where: { id } })) as unknown as UserRecord | null;
      return result ?? undefined;
    },
  };
}

export type UsersRepo = ReturnType<typeof createUsersRepo>;
