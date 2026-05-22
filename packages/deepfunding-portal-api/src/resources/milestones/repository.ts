import { MilestoneEntity } from '../../db/entities/milestone.entity.js';
import type { DeepFundingPortalDb } from '../../shared/types/db.js';
import { type CreateManyOptions, chunkArray, DEFAULT_CHUNK_SIZE } from '../../shared/utils/index.js';
import { normalizeMilestoneToRecord } from './normalize.js';
import type { Milestone, MilestoneRecord } from './types.js';

/**
 * Create a milestones repository bound to the given database instance.
 */
export function createMilestonesRepo(db: DeepFundingPortalDb) {
  const repo = db.dataSource.getRepository(MilestoneEntity);

  return {
    async create(data: Milestone): Promise<void> {
      await repo.insert(normalizeMilestoneToRecord(data));
    },

    async createMany(items: Milestone[], options?: CreateManyOptions): Promise<void> {
      const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
      const chunks = chunkArray(items, chunkSize);
      await db.dataSource.transaction(async (manager) => {
        const txRepo = manager.getRepository(MilestoneEntity);
        for (const chunk of chunks) {
          await txRepo.insert(chunk.map(normalizeMilestoneToRecord));
        }
      });
    },

    async findAll(): Promise<MilestoneRecord[]> {
      return (await repo.find()) as unknown as MilestoneRecord[];
    },

    async findByProposalId(proposalId: number): Promise<MilestoneRecord[]> {
      return (await repo.find({ where: { proposalId } })) as unknown as MilestoneRecord[];
    },

    async findById(id: number): Promise<MilestoneRecord | undefined> {
      const result = (await repo.findOne({ where: { id } })) as unknown as MilestoneRecord | null;
      return result ?? undefined;
    },
  };
}

export type MilestonesRepo = ReturnType<typeof createMilestonesRepo>;
