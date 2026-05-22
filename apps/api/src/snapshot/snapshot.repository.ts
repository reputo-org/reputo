import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { SnapshotStatus } from '@reputo/contracts';
import { type EntityManager, type FindOptionsWhere, Raw, Repository } from 'typeorm';
import type { AlgorithmPresetInput } from '../algorithm-preset/algorithm-preset.repository';
import { SNAPSHOT_UPDATES_CHANNEL, SnapshotEntity, SnapshotOutputEntity } from '../persistence';
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
  // `Date` for symmetry with writes (the service freezes the entity `Date`s).
  createdAt?: Date;
  updatedAt?: Date;
}

// Domain shape returned by the repository. `_id` and `algorithmPreset` are
// the field names HTTP responses and downstream consumers (TemporalService,
// S3 cleanup) expect — diverges from the entity's `id` / `algorithmPresetId`.
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

// Domain shape for `applyExternalUpdate`. Hides the relational layout so the
// service does not have to know that outputs live in a child table.
export interface SnapshotApplyExternalUpdate {
  status?: SnapshotStatus;
  startedAt?: Date;
  completedAt?: Date;
  temporal?: SnapshotTemporal;
  outputs?: SnapshotOutputs;
  error?: SnapshotError;
}

function mapOutputs(outputs: SnapshotOutputEntity[]): SnapshotOutputs | undefined {
  if (outputs.length === 0) return undefined;
  const result: SnapshotOutputs = {};
  for (const output of outputs) {
    result[output.key] = output.value;
  }
  return result;
}

function buildOutputRows(snapshotId: string, outputs: SnapshotOutputs): SnapshotOutputEntity[] {
  const rows: SnapshotOutputEntity[] = [];
  for (const [key, value] of Object.entries(outputs)) {
    if (value === undefined) continue;
    const row = new SnapshotOutputEntity();
    row.snapshotId = snapshotId;
    row.key = key;
    row.value = value;
    rows.push(row);
  }
  return rows;
}

export function mapSnapshotRow(entity: SnapshotEntity): SnapshotRow {
  return {
    _id: entity.id,
    status: entity.status,
    algorithmPreset: entity.algorithmPresetId,
    algorithmPresetFrozen: entity.algorithmPresetFrozen as AlgorithmPresetFrozen,
    temporal: (entity.temporal as SnapshotTemporal | null) ?? undefined,
    outputs: mapOutputs(entity.outputs ?? []),
    error: (entity.error as SnapshotError | null) ?? undefined,
    startedAt: entity.startedAt ?? undefined,
    completedAt: entity.completedAt ?? undefined,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

function buildWhere(filter: SnapshotFilter): FindOptionsWhere<SnapshotEntity> {
  const where: FindOptionsWhere<SnapshotEntity> = {};
  if (filter.status !== undefined) where.status = filter.status;
  if (filter.algorithmPresetId !== undefined) where.algorithmPresetId = filter.algorithmPresetId;

  // `algorithmPresetFrozen` is JSONB; filter via PG's `->>` text accessor so
  // the value is compared as text (the JSON keys are always strings). The
  // functional index declared in the init migration covers this lookup.
  if (filter.frozenKey !== undefined) {
    where.algorithmPresetFrozen = Raw((alias) => `${alias} ->> 'key' = :frozenKey`, { frozenKey: filter.frozenKey });
  }
  if (filter.frozenVersion !== undefined) {
    // Compose with the previous Raw expression if both filters are present so
    // both conditions apply to the same column.
    const previous = where.algorithmPresetFrozen;
    if (previous !== undefined) {
      where.algorithmPresetFrozen = Raw(
        (alias) => `${alias} ->> 'key' = :frozenKey AND ${alias} ->> 'version' = :frozenVersion`,
        { frozenKey: filter.frozenKey, frozenVersion: filter.frozenVersion },
      );
    } else {
      where.algorithmPresetFrozen = Raw((alias) => `${alias} ->> 'version' = :frozenVersion`, {
        frozenVersion: filter.frozenVersion,
      });
    }
  }

  return where;
}

@Injectable()
export class SnapshotRepository {
  constructor(
    @InjectRepository(SnapshotEntity)
    private readonly snapshots: Repository<SnapshotEntity>,
    @InjectRepository(SnapshotOutputEntity)
    private readonly outputs: Repository<SnapshotOutputEntity>,
  ) {}

  async create(createData: SnapshotCreateData): Promise<SnapshotRow> {
    const created = await this.snapshots.manager.transaction(async (manager) => {
      const snapshotRepo = manager.getRepository(SnapshotEntity);
      const outputRepo = manager.getRepository(SnapshotOutputEntity);

      const entity = snapshotRepo.create({
        status: createData.status ?? SnapshotStatus.queued,
        algorithmPresetId: createData.algorithmPreset,
        algorithmPresetFrozen: createData.algorithmPresetFrozen as unknown,
        temporal: (createData.temporal ?? null) as unknown,
        error: null,
        startedAt: null,
        completedAt: null,
      });
      const saved = await snapshotRepo.save(entity);

      if (createData.outputs) {
        const outputRows = buildOutputRows(saved.id, createData.outputs);
        if (outputRows.length > 0) {
          await outputRepo.save(outputRows);
        }
      }

      return manager.getRepository(SnapshotEntity).findOne({ where: { id: saved.id }, relations: { outputs: true } });
    });
    if (!created) {
      throw new Error('Snapshot disappeared mid-create');
    }
    return mapSnapshotRow(created);
  }

  findAll(filter: SnapshotFilter, options: PaginateOptions): Promise<PaginateResult<SnapshotRow>> {
    return paginate<SnapshotEntity, SnapshotRow>({
      repository: this.snapshots,
      where: buildWhere(filter),
      options,
      defaultOrderBy: { createdAt: 'DESC' },
      extra: { relations: { outputs: true } },
      mapRow: mapSnapshotRow,
    });
  }

  async findById(id: string): Promise<SnapshotRow | null> {
    const entity = await this.snapshots.findOne({ where: { id }, relations: { outputs: true } });
    return entity ? mapSnapshotRow(entity) : null;
  }

  async find(filter: SnapshotFilter): Promise<SnapshotRow[]> {
    const rows = await this.snapshots.find({ where: buildWhere(filter), relations: { outputs: true } });
    return rows.map(mapSnapshotRow);
  }

  async deleteById(id: string, client: EntityManager = this.snapshots.manager): Promise<SnapshotRow | null> {
    const repo = client.getRepository(SnapshotEntity);
    const entity = await repo.findOne({ where: { id }, relations: { outputs: true } });
    if (!entity) return null;
    const result = await repo.delete({ id });
    if (!result.affected) return null;
    return mapSnapshotRow(entity);
  }

  async deleteMany(
    filter: SnapshotFilter,
    client: EntityManager = this.snapshots.manager,
  ): Promise<{ deletedCount: number }> {
    const repo = client.getRepository(SnapshotEntity);
    const result = await repo.delete(buildWhere(filter));
    return { deletedCount: result.affected ?? 0 };
  }

  /**
   * Atomically applies an external update from the Temporal `updateSnapshot`
   * activity. The update, the relational `snapshot_outputs` replacement when
   * outputs are provided, and the `pg_notify(snapshot_updates, <id>)` all
   * share one transaction so SSE listeners only see committed rows.
   *
   * Output writes use `delete + save` for full-replacement idempotency:
   * re-applying the same input yields the same final row set.
   *
   * Returns the mapped row or `null` when no snapshot matches the id.
   */
  async applyExternalUpdate(id: string, data: SnapshotApplyExternalUpdate): Promise<SnapshotRow | null> {
    return this.snapshots.manager.transaction(async (manager) => {
      const snapshotRepo = manager.getRepository(SnapshotEntity);
      const outputRepo = manager.getRepository(SnapshotOutputEntity);

      // Load the snapshot row WITHOUT the `outputs` relation. We replace the
      // child rows with delete + insert below, and pulling them in here would
      // make TypeORM try to cascade-save the in-memory copies on
      // `snapshotRepo.save(entity)` — which would conflict with the new rows
      // we just inserted (FK violation / dup PK depending on state).
      const entity = await snapshotRepo.findOne({ where: { id } });
      if (!entity) return null;

      let touched = false;
      if (data.status !== undefined) {
        entity.status = data.status;
        touched = true;
      }
      if (data.startedAt !== undefined) {
        entity.startedAt = data.startedAt;
        touched = true;
      }
      if (data.completedAt !== undefined) {
        entity.completedAt = data.completedAt;
        touched = true;
      }
      if (data.temporal !== undefined) {
        entity.temporal = data.temporal as unknown;
        touched = true;
      }
      if (data.error !== undefined) {
        entity.error = data.error as unknown;
        touched = true;
      }

      if (touched) {
        entity.updatedAt = new Date();
      }
      await snapshotRepo.save(entity);

      if (data.outputs !== undefined) {
        await outputRepo.delete({ snapshotId: id });
        const rows = buildOutputRows(id, data.outputs);
        if (rows.length > 0) {
          await outputRepo.save(rows);
        }
      }

      // Use `pg_notify(channel, payload)` rather than `NOTIFY` so the channel
      // name is bound as a parameter (the literal `NOTIFY` statement can't
      // take placeholders).
      await manager.query('SELECT pg_notify($1, $2)', [SNAPSHOT_UPDATES_CHANNEL, id]);

      const refreshed = await snapshotRepo.findOne({ where: { id }, relations: { outputs: true } });
      return refreshed ? mapSnapshotRow(refreshed) : null;
    });
  }
}
