import type {
  AlgorithmPresetFrozenDto,
  ApiSnapshotActivities,
  GetSnapshotInput,
  SnapshotDto,
  UpdateSnapshotInput,
} from '@reputo/contracts';
import { ApplicationFailure, Context } from '@temporalio/activity';
import type { AlgorithmPresetFrozen, SnapshotRow } from '../snapshot/snapshot.repository';
import type { SnapshotService } from '../snapshot/snapshot.service';

const SNAPSHOT_NOT_FOUND_TYPE = 'SnapshotNotFoundError';

const toIso = (value: Date | string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  return value instanceof Date ? value.toISOString() : value;
};

const toRequiredIso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : value);

function toAlgorithmPresetFrozenDto(frozen: AlgorithmPresetFrozen): AlgorithmPresetFrozenDto {
  return {
    key: frozen.key,
    version: frozen.version,
    inputs: frozen.inputs.map((input) => ({ key: input.key, value: input.value })),
    name: frozen.name,
    description: frozen.description,
    createdAt: toIso(frozen.createdAt),
    updatedAt: toIso(frozen.updatedAt),
  };
}

export function toSnapshotDto(row: SnapshotRow): SnapshotDto {
  return {
    id: row._id,
    status: row.status,
    algorithmPresetId: row.algorithmPreset,
    algorithmPresetFrozen: toAlgorithmPresetFrozenDto(row.algorithmPresetFrozen),
    temporal: row.temporal,
    outputs: row.outputs,
    error: row.error,
    startedAt: toIso(row.startedAt),
    completedAt: toIso(row.completedAt),
    createdAt: toRequiredIso(row.createdAt),
    updatedAt: toRequiredIso(row.updatedAt),
  };
}

/**
 * Wires the contracted `ApiSnapshotActivities` to in-process service calls. The
 * factory is exported so the worker bootstrap can register implementations and
 * tests can invoke activities against a real (or mocked) `SnapshotService`.
 *
 * NOT_FOUND surfaces as a non-retryable `ApplicationFailure` so the workflow
 * does not retry forever when a snapshot has been deleted.
 */
export function createSnapshotActivities(snapshotService: SnapshotService): ApiSnapshotActivities {
  return {
    async getSnapshot(input: GetSnapshotInput): Promise<SnapshotDto> {
      const logger = Context.current().log;
      logger.info('Fetching snapshot', { snapshotId: input.snapshotId });

      const row = await snapshotService.findByIdOrNull(input.snapshotId);
      if (!row) {
        logger.warn('Snapshot not found', { snapshotId: input.snapshotId });
        throw ApplicationFailure.create({
          message: `Snapshot ${input.snapshotId} not found`,
          type: SNAPSHOT_NOT_FOUND_TYPE,
          nonRetryable: true,
        });
      }

      return toSnapshotDto(row);
    },

    async updateSnapshot(input: UpdateSnapshotInput): Promise<void> {
      const logger = Context.current().log;
      logger.info('Updating snapshot', { snapshotId: input.snapshotId, status: input.status });

      const updated = await snapshotService.applyExternalUpdate(input);
      if (!updated) {
        throw ApplicationFailure.create({
          message: `Snapshot ${input.snapshotId} not found`,
          type: SNAPSHOT_NOT_FOUND_TYPE,
          nonRetryable: true,
        });
      }
    },
  };
}
