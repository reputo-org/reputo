import { ProposalEntity } from '../../db/entities/proposal.entity.js';
import type { DeepFundingPortalDb } from '../../shared/types/db.js';
import { type CreateManyOptions, chunkArray, DEFAULT_CHUNK_SIZE } from '../../shared/utils/index.js';
import { normalizeProposalToRecord } from './normalize.js';
import type { ProposalRecord, ProposalWithRound } from './types.js';

export function createProposalsRepo(db: DeepFundingPortalDb) {
  const repo = db.dataSource.getRepository(ProposalEntity);

  return {
    async create(data: ProposalWithRound): Promise<void> {
      await repo.insert(normalizeProposalToRecord(data));
    },

    async createMany(items: ProposalWithRound[], options?: CreateManyOptions): Promise<void> {
      const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
      const chunks = chunkArray(items, chunkSize);
      await db.dataSource.transaction(async (manager) => {
        const txRepo = manager.getRepository(ProposalEntity);
        for (const chunk of chunks) {
          await txRepo.insert(chunk.map(normalizeProposalToRecord));
        }
      });
    },

    async findAll(): Promise<ProposalRecord[]> {
      return (await repo.find()) as unknown as ProposalRecord[];
    },

    async findByRoundId(roundId: number): Promise<ProposalRecord[]> {
      return (await repo.find({ where: { roundId } })) as unknown as ProposalRecord[];
    },

    async findById(id: number): Promise<ProposalRecord | undefined> {
      const result = (await repo.findOne({ where: { id } })) as unknown as ProposalRecord | null;
      return result ?? undefined;
    },
  };
}

export type ProposalsRepo = ReturnType<typeof createProposalsRepo>;
