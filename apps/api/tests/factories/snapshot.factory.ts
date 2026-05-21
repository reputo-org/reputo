import { faker } from '@faker-js/faker';
import type { Snapshot as PrismaSnapshot, SnapshotStatus } from '@prisma/client';
import type { PrismaService } from '../../src/persistence';

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
  prisma: PrismaService,
  algorithmPresetId: string,
  algorithmPresetFrozen: AlgorithmPresetFrozen,
  overrides: Partial<Omit<SnapshotCreate, 'algorithmPreset' | 'algorithmPresetFrozen'>> = {},
): Promise<PrismaSnapshot> {
  const dto = makeSnapshot(algorithmPresetId, algorithmPresetFrozen, overrides);
  return prisma.snapshot.create({
    data: {
      status: dto.status ?? 'queued',
      algorithmPresetId,
      algorithmPresetFrozen: dto.algorithmPresetFrozen,
      temporal: dto.temporal ?? undefined,
      outputs: (dto.outputs as Record<string, unknown> | undefined) ?? undefined,
    },
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
