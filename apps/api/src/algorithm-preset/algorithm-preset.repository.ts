import { Injectable } from '@nestjs/common';
import type {
  Prisma,
  AlgorithmPreset as PrismaAlgorithmPreset,
  AlgorithmPresetInput as PrismaAlgorithmPresetInput,
} from '@prisma/client';
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

type PrismaAlgorithmPresetWithInputs = PrismaAlgorithmPreset & {
  inputs: PrismaAlgorithmPresetInput[];
};

// Always include the relational inputs ordered by `position` so callers receive
// the rows in the same order they were written.
const includeOrderedInputs = {
  inputs: { orderBy: { position: 'asc' } },
} as const satisfies Prisma.AlgorithmPresetInclude;

const isRecordNotFound = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2025';

export function mapAlgorithmPresetRow(row: PrismaAlgorithmPresetWithInputs): AlgorithmPresetRow {
  return {
    _id: row.id,
    key: row.key,
    version: row.version,
    inputs: row.inputs.map((input) => ({ key: input.key, value: input.value as unknown })),
    name: row.name ?? undefined,
    description: row.description ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function buildInputCreateRows(
  inputs: ReadonlyArray<AlgorithmPresetInput>,
): Prisma.AlgorithmPresetInputCreateWithoutAlgorithmPresetInput[] {
  return inputs.map((input, position) => ({
    key: input.key,
    value: input.value as Prisma.InputJsonValue,
    position,
  }));
}

@Injectable()
export class AlgorithmPresetRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(createDto: CreateAlgorithmPresetDto): Promise<AlgorithmPresetRow> {
    const created = await this.prisma.algorithmPreset.create({
      data: {
        key: createDto.key,
        version: createDto.version,
        name: createDto.name ?? null,
        description: createDto.description ?? null,
        inputs: { create: buildInputCreateRows(createDto.inputs) },
      },
      include: includeOrderedInputs,
    });
    return mapAlgorithmPresetRow(created);
  }

  findAll(filter: AlgorithmPresetFilter, options: PaginateOptions): Promise<PaginateResult<AlgorithmPresetRow>> {
    const where: Prisma.AlgorithmPresetWhereInput = {};
    if (filter.key !== undefined) where.key = filter.key;
    if (filter.version !== undefined) where.version = filter.version;

    return paginate({
      model: {
        count: (args) => this.prisma.algorithmPreset.count(args),
        findMany: (args) =>
          this.prisma.algorithmPreset.findMany({ ...args, include: includeOrderedInputs }) as Promise<
            PrismaAlgorithmPresetWithInputs[]
          >,
      },
      where,
      options,
      defaultOrderBy: { createdAt: 'desc' },
      mapRow: mapAlgorithmPresetRow,
    });
  }

  async findById(id: string): Promise<AlgorithmPresetRow | null> {
    const row = await this.prisma.algorithmPreset.findUnique({
      where: { id },
      include: includeOrderedInputs,
    });
    return row ? mapAlgorithmPresetRow(row) : null;
  }

  async updateById(id: string, updateDto: UpdateAlgorithmPresetDto): Promise<AlgorithmPresetRow | null> {
    const data: Prisma.AlgorithmPresetUpdateInput = {};
    if (updateDto.name !== undefined) data.name = updateDto.name;
    if (updateDto.description !== undefined) data.description = updateDto.description;

    // Full-replacement semantics for inputs: drop existing rows and recreate
    // them, preserving the caller-supplied order via the `position` column.
    // The nested write runs in Prisma's implicit transaction, so the preset's
    // children are never observed in a half-updated state.
    if (updateDto.inputs !== undefined) {
      data.inputs = {
        deleteMany: {},
        create: buildInputCreateRows(updateDto.inputs),
      };
      // `@updatedAt` does not fire when only nested relations change, so bump
      // it explicitly to keep the wire contract (clients rely on updatedAt
      // changing whenever a write touches the preset).
      data.updatedAt = new Date();
    }

    try {
      const row = await this.prisma.algorithmPreset.update({
        where: { id },
        data,
        include: includeOrderedInputs,
      });
      return mapAlgorithmPresetRow(row);
    } catch (err) {
      if (isRecordNotFound(err)) return null;
      throw err;
    }
  }

  async deleteById(id: string, client: PrismaClientLike = this.prisma): Promise<AlgorithmPresetRow | null> {
    try {
      const row = await client.algorithmPreset.delete({
        where: { id },
        include: includeOrderedInputs,
      });
      return mapAlgorithmPresetRow(row);
    } catch (err) {
      if (isRecordNotFound(err)) return null;
      throw err;
    }
  }
}
