import { faker } from '@faker-js/faker';
import { SnapshotStatus } from '@reputo/contracts';
import type { DataSource, EntityManager } from 'typeorm';
import { SnapshotEntity, SnapshotOutputEntity } from '../../src/persistence';

type AlgorithmPresetFrozen = {
  key: string;
  version: string;
  inputs: Array<{ key: string; value?: unknown }>;
  name?: string;
  description?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

export type SnapshotCreate = {
  algorithmPreset: string;
  algorithmPresetFrozen: AlgorithmPresetFrozen;
  status?: SnapshotStatus;
  temporal?: {
    workflowId?: string;
    runId?: string;
    taskQueue?: string;
  };
  outputs?: unknown;
};

export type SnapshotCreateDto = {
  algorithmPresetId: string;
  temporal?: {
    workflowId?: string;
    runId?: string;
    taskQueue?: string;
  };
  outputs?: unknown;
};

export function makeSnapshot(
  algorithmPreset: string,
  algorithmPresetFrozen: AlgorithmPresetFrozen,
  overrides: Partial<Omit<SnapshotCreate, 'algorithmPreset' | 'algorithmPresetFrozen'>> = {},
): SnapshotCreate {
  return {
    algorithmPreset,
    algorithmPresetFrozen,
    status: overrides.status,
    temporal: overrides.temporal,
    outputs: overrides.outputs,
  };
}

export function makeSnapshotDto(
  algorithmPresetId: string,
  overrides: Partial<Omit<SnapshotCreateDto, 'algorithmPresetId'>> = {},
): SnapshotCreateDto {
  return {
    algorithmPresetId,
    temporal: overrides.temporal,
    outputs: overrides.outputs,
  };
}

export async function insertSnapshot(
  source: DataSource | EntityManager,
  algorithmPresetId: string,
  algorithmPresetFrozen: AlgorithmPresetFrozen,
  overrides: Partial<Omit<SnapshotCreate, 'algorithmPreset' | 'algorithmPresetFrozen'>> = {},
): Promise<SnapshotEntity> {
  const manager = 'manager' in source ? source.manager : source;
  const dto = makeSnapshot(algorithmPresetId, algorithmPresetFrozen, overrides);
  return manager.transaction(async (tx) => {
    const snapshotRepo = tx.getRepository(SnapshotEntity);
    const outputRepo = tx.getRepository(SnapshotOutputEntity);
    const entity = snapshotRepo.create({
      status: (dto.status ?? SnapshotStatus.queued) as SnapshotStatus,
      algorithmPresetId,
      algorithmPresetFrozen: dto.algorithmPresetFrozen as unknown,
      temporal: (dto.temporal ?? null) as unknown,
      error: null,
      startedAt: null,
      completedAt: null,
    });
    const saved = await snapshotRepo.save(entity);
    const outputs = dto.outputs as Record<string, string | undefined> | undefined;
    if (outputs) {
      const rows = Object.entries(outputs)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) =>
          outputRepo.create({
            snapshotId: saved.id,
            key,
            value: value as string,
          }),
        );
      if (rows.length > 0) {
        await outputRepo.save(rows);
      }
    }
    return saved;
  });
}

export function randomSnapshot(
  algorithmPresetId: string,
  algorithmPresetFrozen: AlgorithmPresetFrozen,
): SnapshotCreate {
  const maybe = <T>(val: T) => (faker.datatype.boolean() ? val : undefined);
  return makeSnapshot(algorithmPresetId, algorithmPresetFrozen, {
    temporal: maybe({
      workflowId: faker.string.alphanumeric(20),
      runId: faker.string.alphanumeric(10),
      taskQueue: 'algorithms',
    }),
    outputs: maybe({
      csv: faker.string.alphanumeric(16),
    }),
  });
}
