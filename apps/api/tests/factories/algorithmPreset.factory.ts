import { faker } from '@faker-js/faker';
import type { AlgorithmPreset as PrismaAlgorithmPreset } from '@prisma/client';
import type { PrismaService } from '../../src/persistence';

export type AlgorithmPresetCreate = {
  key?: string;
  version?: string;
  inputs?: Array<{ key: string; value?: unknown }>;
  name?: string;
  description?: string;
};

export function makeAlgorithmPreset(overrides: AlgorithmPresetCreate = {}) {
  return {
    key: overrides.key ?? 'voting_engagement',
    version: overrides.version ?? '1.0.0',
    inputs: overrides.inputs ?? [
      { key: 'sub_ids', value: 'uploads/sub_ids.json' },
      { key: 'votes', value: 'uploads/votes.csv' },
    ],
    name: overrides.name,
    description: overrides.description,
  };
}

export async function insertAlgorithmPreset(
  prisma: PrismaService,
  overrides: AlgorithmPresetCreate = {},
): Promise<PrismaAlgorithmPreset> {
  const dto = makeAlgorithmPreset(overrides);
  return prisma.algorithmPreset.create({
    data: {
      key: dto.key,
      version: dto.version,
      inputs: dto.inputs,
      name: dto.name ?? null,
      description: dto.description ?? null,
    },
  });
}

export function randomAlgorithmPreset(): AlgorithmPresetCreate {
  const maybe = <T>(val: T) => (faker.datatype.boolean() ? val : undefined);
  return makeAlgorithmPreset({
    key: faker.word.noun().toLowerCase().replace(/\s+/g, '_'),
    version: `${faker.number.int({ min: 1, max: 9 })}.${faker.number.int({ min: 0, max: 9 })}.${faker.number.int({ min: 0, max: 9 })}`,
    name: maybe(faker.lorem.words(3)),
    description: maybe(faker.lorem.sentence(10)),
  });
}
