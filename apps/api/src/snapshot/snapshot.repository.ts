import { Injectable } from '@nestjs/common';
import type { Snapshot as PrismaSnapshot, SnapshotStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { AlgorithmPresetInput, PrismaClientLike } from '../algorithm-preset/algorithm-preset.repository';
import { PrismaService } from '../persistence';
import type { PaginateOptions, PaginateResult } from '../shared/persistence';
import { paginate } from '../shared/persistence';

export interface SnapshotTemporal {
  workflowId?: string;
  runId?: string;
  taskQueue?: string;
  algorithmTaskQueue?: string;
}

export interface SnapshotOutputs {
  [key: string]: string | undefined;
}

export interface SnapshotError {
  message: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface AlgorithmPresetFrozen {
  key: string;
  version: string;
  inputs: AlgorithmPresetInput[];
  name?: string;
  description?: string;
  // JSON-stored, so reads round-trip these as ISO strings; the type stays
  // `Date` for symmetry with writes (the service freezes Prisma `Date`s) and
  // mirrors the @reputo/database `AlgorithmPresetFrozen` shape the
  // TemporalService input still expects.
  createdAt?: Date;
  updatedAt?: Date;
}

// Domain shape returned by the repository. `_id` and `algorithmPreset` mirror
// the previous Mongoose `lean()` payload so HTTP responses and downstream
// consumers (TemporalService, S3 cleanup) remain unchanged.
export interface SnapshotRow {
  _id: string;
  status: SnapshotStatus;
  algorithmPreset: string;
  algorithmPresetFrozen: AlgorithmPresetFrozen;
  temporal?: SnapshotTemporal;
  outputs?: SnapshotOutputs;
  error?: SnapshotError;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SnapshotCreateData {
  status?: SnapshotStatus;
  algorithmPreset: string;
  algorithmPresetFrozen: AlgorithmPresetFrozen;
  temporal?: SnapshotTemporal;
  outputs?: SnapshotOutputs;
}

export interface SnapshotFilter {
  status?: SnapshotStatus;
  algorithmPresetId?: string;
  frozenKey?: string;
  frozenVersion?: string;
}

const isRecordNotFound = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2025';

export function mapSnapshotRow(row: PrismaSnapshot): SnapshotRow {
  return {
    _id: row.id,
    status: row.status,
    algorithmPreset: row.algorithmPresetId,
    algorithmPresetFrozen: row.algorithmPresetFrozen as unknown as AlgorithmPresetFrozen,
    temporal: (row.temporal as unknown as SnapshotTemporal | null) ?? undefined,
    outputs: (row.outputs as unknown as SnapshotOutputs | null) ?? undefined,
    error: (row.error as unknown as SnapshotError | null) ?? undefined,
    startedAt: row.startedAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function buildWhere(filter: SnapshotFilter): Prisma.SnapshotWhereInput {
  const where: Prisma.SnapshotWhereInput = {};
  if (filter.status !== undefined) where.status = filter.status;
  if (filter.algorithmPresetId !== undefined) where.algorithmPresetId = filter.algorithmPresetId;

  const frozenFilters: Prisma.SnapshotWhereInput[] = [];
  if (filter.frozenKey !== undefined) {
    frozenFilters.push({ algorithmPresetFrozen: { path: ['key'], equals: filter.frozenKey } });
  }
  if (filter.frozenVersion !== undefined) {
    frozenFilters.push({ algorithmPresetFrozen: { path: ['version'], equals: filter.frozenVersion } });
  }
  if (frozenFilters.length > 0) {
    where.AND = frozenFilters;
  }

  return where;
}

@Injectable()
export class SnapshotRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(createData: SnapshotCreateData): Promise<SnapshotRow> {
    const created = await this.prisma.snapshot.create({
      data: {
        status: createData.status ?? 'queued',
        algorithmPresetId: createData.algorithmPreset,
        algorithmPresetFrozen: createData.algorithmPresetFrozen as unknown as Prisma.InputJsonValue,
        temporal: createData.temporal ? (createData.temporal as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        outputs: createData.outputs ? (createData.outputs as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
    return mapSnapshotRow(created);
  }

  findAll(filter: SnapshotFilter, options: PaginateOptions): Promise<PaginateResult<SnapshotRow>> {
    return paginate({
      model: this.prisma.snapshot,
      where: buildWhere(filter),
      options,
      defaultOrderBy: { createdAt: 'desc' },
      mapRow: mapSnapshotRow,
    });
  }

  async findById(id: string): Promise<SnapshotRow | null> {
    const row = await this.prisma.snapshot.findUnique({ where: { id } });
    return row ? mapSnapshotRow(row) : null;
  }

  async find(filter: SnapshotFilter): Promise<SnapshotRow[]> {
    const rows = await this.prisma.snapshot.findMany({ where: buildWhere(filter) });
    return rows.map(mapSnapshotRow);
  }

  async deleteById(id: string, client: PrismaClientLike = this.prisma): Promise<SnapshotRow | null> {
    try {
      const row = await client.snapshot.delete({ where: { id } });
      return mapSnapshotRow(row);
    } catch (err) {
      if (isRecordNotFound(err)) return null;
      throw err;
    }
  }

  async deleteMany(filter: SnapshotFilter, client: PrismaClientLike = this.prisma): Promise<{ deletedCount: number }> {
    const result = await client.snapshot.deleteMany({ where: buildWhere(filter) });
    return { deletedCount: result.count };
  }

  /**
   * Atomically applies an external update from the Temporal `updateSnapshot`
   * activity. The update and the `pg_notify('snapshot_updates', <id>)` share
   * one transaction so SSE listeners (task 09) only see committed rows.
   *
   * Returns the mapped row or `null` when no snapshot matches the id.
   */
  async applyExternalUpdate(id: string, data: Prisma.SnapshotUpdateInput): Promise<SnapshotRow | null> {
    try {
      const [updated] = await this.prisma.$transaction([
        this.prisma.snapshot.update({ where: { id }, data }),
        this.prisma.$executeRaw`SELECT pg_notify('snapshot_updates', ${id})`,
      ]);
      return mapSnapshotRow(updated);
    } catch (err) {
      if (isRecordNotFound(err)) return null;
      throw err;
    }
  }
}
