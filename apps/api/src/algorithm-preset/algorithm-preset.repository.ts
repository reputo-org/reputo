import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, type FindOptionsWhere, QueryFailedError, Repository } from 'typeorm';
import { AlgorithmPresetEntity, AlgorithmPresetInputEntity } from '../persistence';
import type { PaginateOptions, PaginateResult } from '../shared/persistence';
import { paginate } from '../shared/persistence';
import type { CreateAlgorithmPresetDto, UpdateAlgorithmPresetDto } from './dto';

export interface AlgorithmPresetInput {
  key: string;
  value?: unknown;
}

// Domain shape used by the rest of the API. `_id` (rather than TypeORM's `id`)
// matches the HTTP wire format, and `inputs` is typed as the structured pair
// list rather than the entity row shape.
export interface AlgorithmPresetRow {
  _id: string;
  key: string;
  version: string;
  inputs: AlgorithmPresetInput[];
  name?: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlgorithmPresetFilter {
  key?: string;
  version?: string;
}

// Re-exported for callers that want to pass a transactional manager through.
export type TransactionClient = EntityManager;

const sortInputs = (inputs: AlgorithmPresetInputEntity[]): AlgorithmPresetInputEntity[] =>
  [...inputs].sort((a, b) => a.position - b.position);

export function mapAlgorithmPresetRow(entity: AlgorithmPresetEntity): AlgorithmPresetRow {
  return {
    _id: entity.id,
    key: entity.key,
    version: entity.version,
    inputs: sortInputs(entity.inputs ?? []).map((input) => ({ key: input.key, value: input.value })),
    name: entity.name ?? undefined,
    description: entity.description ?? undefined,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

function buildInputRows(
  algorithmPresetId: string,
  inputs: ReadonlyArray<AlgorithmPresetInput>,
): AlgorithmPresetInputEntity[] {
  return inputs.map((input, position) => {
    const row = new AlgorithmPresetInputEntity();
    row.algorithmPresetId = algorithmPresetId;
    row.key = input.key;
    row.value = input.value;
    row.position = position;
    return row;
  });
}

@Injectable()
export class AlgorithmPresetRepository {
  constructor(
    @InjectRepository(AlgorithmPresetEntity)
    private readonly presets: Repository<AlgorithmPresetEntity>,
    @InjectRepository(AlgorithmPresetInputEntity)
    private readonly inputs: Repository<AlgorithmPresetInputEntity>,
  ) {}

  async create(createDto: CreateAlgorithmPresetDto): Promise<AlgorithmPresetRow> {
    const created = await this.presets.manager.transaction(async (manager) => {
      const presetRepo = manager.getRepository(AlgorithmPresetEntity);
      const inputRepo = manager.getRepository(AlgorithmPresetInputEntity);

      const entity = presetRepo.create({
        key: createDto.key,
        version: createDto.version,
        name: createDto.name ?? null,
        description: createDto.description ?? null,
      });
      const saved = await presetRepo.save(entity);
      const inputRows = buildInputRows(saved.id, createDto.inputs);
      if (inputRows.length > 0) {
        await inputRepo.save(inputRows);
      }
      return this.findByIdWithManager(manager, saved.id);
    });
    if (!created) {
      throw new Error('AlgorithmPreset disappeared mid-create');
    }
    return mapAlgorithmPresetRow(created);
  }

  findAll(filter: AlgorithmPresetFilter, options: PaginateOptions): Promise<PaginateResult<AlgorithmPresetRow>> {
    const where: FindOptionsWhere<AlgorithmPresetEntity> = {};
    if (filter.key !== undefined) where.key = filter.key;
    if (filter.version !== undefined) where.version = filter.version;

    return paginate<AlgorithmPresetEntity, AlgorithmPresetRow>({
      repository: this.presets,
      where,
      options,
      defaultOrderBy: { createdAt: 'DESC' },
      extra: { relations: { inputs: true } },
      mapRow: mapAlgorithmPresetRow,
    });
  }

  async findById(id: string): Promise<AlgorithmPresetRow | null> {
    const entity = await this.presets.findOne({ where: { id }, relations: { inputs: true } });
    return entity ? mapAlgorithmPresetRow(entity) : null;
  }

  async updateById(id: string, updateDto: UpdateAlgorithmPresetDto): Promise<AlgorithmPresetRow | null> {
    const updated = await this.presets.manager.transaction(async (manager) => {
      const presetRepo = manager.getRepository(AlgorithmPresetEntity);
      const inputRepo = manager.getRepository(AlgorithmPresetInputEntity);

      const entity = await presetRepo.findOne({ where: { id } });
      if (!entity) return null;

      if (updateDto.name !== undefined) entity.name = updateDto.name ?? null;
      if (updateDto.description !== undefined) entity.description = updateDto.description ?? null;

      if (updateDto.inputs !== undefined) {
        // `@UpdateDateColumn` does not fire when only nested relations change;
        // bump it explicitly so callers see `updatedAt` move whenever a
        // write touches the preset.
        entity.updatedAt = new Date();
        await inputRepo.delete({ algorithmPresetId: id });
        const inputRows = buildInputRows(id, updateDto.inputs);
        if (inputRows.length > 0) {
          await inputRepo.save(inputRows);
        }
      }

      await presetRepo.save(entity);
      return this.findByIdWithManager(manager, id);
    });
    return updated ? mapAlgorithmPresetRow(updated) : null;
  }

  async deleteById(id: string, client: EntityManager = this.presets.manager): Promise<AlgorithmPresetRow | null> {
    const entity = await this.findByIdWithManager(client, id);
    if (!entity) return null;
    const result = await client.getRepository(AlgorithmPresetEntity).delete({ id });
    if (!result.affected) return null;
    return mapAlgorithmPresetRow(entity);
  }

  // P23505 is Postgres' unique-violation SQLSTATE; surfaced by TypeORM via
  // QueryFailedError.driverError.code for the `pg` driver.
  isDuplicateKeyError(error: unknown): boolean {
    return error instanceof QueryFailedError && (error.driverError as { code?: string })?.code === '23505';
  }

  private async findByIdWithManager(manager: EntityManager, id: string): Promise<AlgorithmPresetEntity | null> {
    return manager.getRepository(AlgorithmPresetEntity).findOne({ where: { id }, relations: { inputs: true } });
  }
}
