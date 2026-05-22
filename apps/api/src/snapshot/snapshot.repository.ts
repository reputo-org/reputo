import { Injectable } from '@nestjs/common';
import type {
  Snapshot as PrismaSnapshot,
  SnapshotOutput as PrismaSnapshotOutput,
  SnapshotStatus,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { AlgorithmPresetInput, PrismaClientLike } from '../algorithm-preset/algorithm-preset.repository';
import { PrismaService, SNAPSHOT_UPDATES_CHANNEL } from '../persistence';
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
  // `Date` for symmetry with writes (the service freezes Prisma `Date`s).
  createdAt?: Date;
  updatedAt?: Date;
}

// Domain shape returned by the repository. `_id` and `algorithmPreset` are
// the field names HTTP responses and downstream consumers (TemporalService,
// S3 cleanup) expect — diverges from Prisma's `id` / `algorithmPresetId`.
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

// Domain shape for `applyExternalUpdate`. Hides the Prisma/relational layout
// so the service does not have to know that outputs live in a child table.
export interface SnapshotApplyExternalUpdate {
  status?: SnapshotStatus;
  startedAt?: Date;
  completedAt?: Date;
  temporal?: SnapshotTemporal;
  outputs?: SnapshotOutputs;
  error?: SnapshotError;
}

const isRecordNotFound = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2025';

type PrismaSnapshotWithOutputs = PrismaSnapshot & {
  outputs: PrismaSnapshotOutput[];
};

// Always include the relational outputs so callers receive a fully-materialised
// `SnapshotRow` without re-querying the child table.
const includeOutputs = {
  outputs: true,
} as const satisfies Prisma.SnapshotInclude;

function mapOutputs(outputs: PrismaSnapshotOutput[]): SnapshotOutputs | undefined {
  if (outputs.length === 0) return undefined;
  const result: SnapshotOutputs = {};
  for (const output of outputs) {
    result[output.key] = output.value;
  }
  return result;
}

function buildOutputCreateRows(outputs: SnapshotOutputs): Prisma.SnapshotOutputCreateWithoutSnapshotInput[] {
  const rows: Prisma.SnapshotOutputCreateWithoutSnapshotInput[] = [];
  for (const [key, value] of Object.entries(outputs)) {
    if (value === undefined) continue;
    rows.push({ key, value });
  }
  return rows;
}

export function mapSnapshotRow(row: PrismaSnapshotWithOutputs): SnapshotRow {
  return {
    _id: row.id,
    status: row.status,
    algorithmPreset: row.algorithmPresetId,
    algorithmPresetFrozen: row.algorithmPresetFrozen as unknown as AlgorithmPresetFrozen,
    temporal: (row.temporal as unknown as SnapshotTemporal | null) ?? undefined,
    outputs: mapOutputs(row.outputs),
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
    const outputs = createData.outputs;
    const created = await this.prisma.snapshot.create({
      data: {
        status: createData.status ?? 'queued',
        algorithmPresetId: createData.algorithmPreset,
        algorithmPresetFrozen: createData.algorithmPresetFrozen as unknown as Prisma.InputJsonValue,
        temporal: createData.temporal ? (createData.temporal as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        ...(outputs ? { outputs: { create: buildOutputCreateRows(outputs) } } : {}),
      },
      include: includeOutputs,
    });
    return mapSnapshotRow(created);
  }

  findAll(filter: SnapshotFilter, options: PaginateOptions): Promise<PaginateResult<SnapshotRow>> {
    return paginate({
      model: {
        count: (args) => this.prisma.snapshot.count(args),
        findMany: (args) =>
          this.prisma.snapshot.findMany({ ...args, include: includeOutputs }) as Promise<PrismaSnapshotWithOutputs[]>,
      },
      where: buildWhere(filter),
      options,
      defaultOrderBy: { createdAt: 'desc' },
      mapRow: mapSnapshotRow,
    });
  }

  async findById(id: string): Promise<SnapshotRow | null> {
    const row = await this.prisma.snapshot.findUnique({ where: { id }, include: includeOutputs });
    return row ? mapSnapshotRow(row) : null;
  }

  async find(filter: SnapshotFilter): Promise<SnapshotRow[]> {
    const rows = await this.prisma.snapshot.findMany({ where: buildWhere(filter), include: includeOutputs });
    return rows.map(mapSnapshotRow);
  }

  async deleteById(id: string, client: PrismaClientLike = this.prisma): Promise<SnapshotRow | null> {
    try {
      const row = await client.snapshot.delete({ where: { id }, include: includeOutputs });
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
   * activity. The update, the relational `snapshot_outputs` replacement when
   * outputs are provided, and the `pg_notify(snapshot_updates, <id>)` all
   * share one transaction so SSE listeners only see committed rows.
   *
   * Output writes use `deleteMany + create` for full-replacement idempotency:
   * re-applying the same input yields the same final row set.
   *
   * Returns the mapped row or `null` when no snapshot matches the id.
   */
  async applyExternalUpdate(id: string, data: SnapshotApplyExternalUpdate): Promise<SnapshotRow | null> {
    const updateData: Prisma.SnapshotUpdateInput = {};
    if (data.status !== undefined) updateData.status = data.status;
    if (data.startedAt !== undefined) updateData.startedAt = data.startedAt;
    if (data.completedAt !== undefined) updateData.completedAt = data.completedAt;
    if (data.temporal !== undefined) updateData.temporal = data.temporal as unknown as Prisma.InputJsonValue;
    if (data.error !== undefined) updateData.error = data.error as unknown as Prisma.InputJsonValue;
    if (data.outputs !== undefined) {
      updateData.outputs = {
        deleteMany: {},
        create: buildOutputCreateRows(data.outputs),
      };
    }

    try {
      const [updated] = await this.prisma.$transaction([
        this.prisma.snapshot.update({ where: { id }, data: updateData, include: includeOutputs }),
        this.prisma.$executeRaw`SELECT pg_notify(${SNAPSHOT_UPDATES_CHANNEL}, ${id})`,
      ]);
      return mapSnapshotRow(updated);
    } catch (err) {
      if (isRecordNotFound(err)) return null;
      throw err;
    }
  }
}
