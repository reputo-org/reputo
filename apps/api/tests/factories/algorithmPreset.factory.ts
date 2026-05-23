import { faker } from '@faker-js/faker';
import type { DataSource, EntityManager } from 'typeorm';
import { AlgorithmPresetEntity, AlgorithmPresetInputEntity } from '../../src/persistence';

export type AlgorithmPresetCreate = {
  key?: string;
  version?: string;
  inputs?: Array<{ key: string; value?: unknown }>;
  name?: string;
  description?: string;
};

// `inputs` is materialised from the relational `algorithm_preset_inputs` table
// so callers (snapshot factories, e2e suites) can build frozen-preset payloads
// without re-querying the child table themselves.
export type AlgorithmPresetWithInputs = AlgorithmPresetEntity & {
  inputs: Array<Pick<AlgorithmPresetInputEntity, 'key' | 'value' | 'position'>>;
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
  source: DataSource | EntityManager,
  overrides: AlgorithmPresetCreate = {},
): Promise<AlgorithmPresetWithInputs> {
  const manager = 'manager' in source ? source.manager : source;
  const dto = makeAlgorithmPreset(overrides);
  return manager.transaction(async (tx) => {
    const presetRepo = tx.getRepository(AlgorithmPresetEntity);
    const inputRepo = tx.getRepository(AlgorithmPresetInputEntity);
    const saved = await presetRepo.save(
      presetRepo.create({
        key: dto.key,
        version: dto.version,
        name: dto.name ?? null,
        description: dto.description ?? null,
      }),
    );
    const inputs = dto.inputs.map((input, position) =>
      inputRepo.create({
        algorithmPresetId: saved.id,
        key: input.key,
        value: input.value,
        position,
      }),
    );
    if (inputs.length > 0) {
      await inputRepo.save(inputs);
    }
    const refreshed = await presetRepo.findOne({ where: { id: saved.id }, relations: { inputs: true } });
    return refreshed as AlgorithmPresetWithInputs;
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
