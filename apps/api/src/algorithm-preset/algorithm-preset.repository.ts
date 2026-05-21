import { Injectable } from '@nestjs/common';
import type { Prisma, AlgorithmPreset as PrismaAlgorithmPreset } from '@prisma/client';
import { PrismaService } from '../persistence';
import type { PaginateOptions, PaginateResult } from '../shared/persistence';
import { paginate } from '../shared/persistence';
import type { CreateAlgorithmPresetDto, UpdateAlgorithmPresetDto } from './dto';

export interface AlgorithmPresetInput {
  key: string;
  value?: unknown;
}

// Domain shape used by the rest of the API. `_id` (rather than Prisma's `id`)
// matches the HTTP wire format, and `inputs` is typed as the structured pair
// list rather than `Prisma.JsonValue`.
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

export type PrismaClientLike = PrismaService | Prisma.TransactionClient;

const isRecordNotFound = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2025';

export function mapAlgorithmPresetRow(row: PrismaAlgorithmPreset): AlgorithmPresetRow {
  return {
    _id: row.id,
    key: row.key,
    version: row.version,
    inputs: (row.inputs as unknown as AlgorithmPresetInput[]) ?? [],
    name: row.name ?? undefined,
    description: row.description ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class AlgorithmPresetRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(createDto: CreateAlgorithmPresetDto): Promise<AlgorithmPresetRow> {
    const created = await this.prisma.algorithmPreset.create({
      data: {
        key: createDto.key,
        version: createDto.version,
        inputs: createDto.inputs as unknown as Prisma.InputJsonValue,
        name: createDto.name ?? null,
        description: createDto.description ?? null,
      },
    });
    return mapAlgorithmPresetRow(created);
  }

  findAll(filter: AlgorithmPresetFilter, options: PaginateOptions): Promise<PaginateResult<AlgorithmPresetRow>> {
    const where: Prisma.AlgorithmPresetWhereInput = {};
    if (filter.key !== undefined) where.key = filter.key;
    if (filter.version !== undefined) where.version = filter.version;

    return paginate({
      model: this.prisma.algorithmPreset,
      where,
      options,
      defaultOrderBy: { createdAt: 'desc' },
      mapRow: mapAlgorithmPresetRow,
    });
  }

  async findById(id: string): Promise<AlgorithmPresetRow | null> {
    const row = await this.prisma.algorithmPreset.findUnique({ where: { id } });
    return row ? mapAlgorithmPresetRow(row) : null;
  }

  async updateById(id: string, updateDto: UpdateAlgorithmPresetDto): Promise<AlgorithmPresetRow | null> {
    const data: Prisma.AlgorithmPresetUpdateInput = {};
    if (updateDto.inputs !== undefined) {
      data.inputs = updateDto.inputs as unknown as Prisma.InputJsonValue;
    }
    if (updateDto.name !== undefined) data.name = updateDto.name;
    if (updateDto.description !== undefined) data.description = updateDto.description;

    try {
      const row = await this.prisma.algorithmPreset.update({ where: { id }, data });
      return mapAlgorithmPresetRow(row);
    } catch (err) {
      if (isRecordNotFound(err)) return null;
      throw err;
    }
  }

  async deleteById(id: string, client: PrismaClientLike = this.prisma): Promise<AlgorithmPresetRow | null> {
    try {
      const row = await client.algorithmPreset.delete({ where: { id } });
      return mapAlgorithmPresetRow(row);
    } catch (err) {
      if (isRecordNotFound(err)) return null;
      throw err;
    }
  }
}
