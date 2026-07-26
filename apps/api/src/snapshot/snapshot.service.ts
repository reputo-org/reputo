import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { UpdateSnapshotInput } from '@reputo/contracts';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AlgorithmPresetRepository } from '../algorithm-preset/algorithm-preset.repository';
import { SnapshotWorkflowStartException, throwNotFoundError } from '../shared/exceptions';
import { getAlgorithmDefinitionOrThrow, validateAlgorithmInputs } from '../shared/utils';
import { StorageService } from '../storage/storage.service';
import { TemporalService } from '../temporal';
import type { CreateSnapshotDto, ListSnapshotsQueryDto } from './dto';
import type {
  AlgorithmPresetFrozen,
  SnapshotApplyExternalUpdate,
  SnapshotCreateData,
  SnapshotOutputs,
  SnapshotRow,
} from './snapshot.repository';
import { SnapshotRepository } from './snapshot.repository';

const ALGORITHM_PRESET_ENTITY = 'AlgorithmPreset';
const SNAPSHOT_ENTITY = 'Snapshot';

@Injectable()
export class SnapshotService {
  private readonly storageMaxSizeBytes: number;
  private readonly storageContentTypeAllowlist: string;

  constructor(
    @InjectPinoLogger(SnapshotService.name)
    private readonly logger: PinoLogger,
    private readonly repository: SnapshotRepository,
    private readonly algorithmPresetRepository: AlgorithmPresetRepository,
    private readonly temporalService: TemporalService,
    private readonly storageService: StorageService,
    configService: ConfigService,
  ) {
    this.storageMaxSizeBytes = configService.get<number>('storage.maxSizeBytes') as number;
    this.storageContentTypeAllowlist = configService.get<string>('storage.contentTypeAllowlist') as string;
  }

  async create(createDto: CreateSnapshotDto) {
    const algorithmPreset = await this.algorithmPresetRepository.findById(createDto.algorithmPresetId);
    if (!algorithmPreset) {
      throwNotFoundError(createDto.algorithmPresetId, ALGORITHM_PRESET_ENTITY);
    }

    const algorithmDefinition = getAlgorithmDefinitionOrThrow(algorithmPreset.key, algorithmPreset.version);
    await validateAlgorithmInputs({
      definition: algorithmDefinition,
      inputs: algorithmPreset.inputs,
      storageService: this.storageService,
      storageMaxSizeBytes: this.storageMaxSizeBytes,
      storageContentTypeAllowlist: this.storageContentTypeAllowlist,
    });

    const frozenAlgorithmPreset: AlgorithmPresetFrozen = {
      key: algorithmPreset.key,
      version: algorithmPreset.version,
      inputs: algorithmPreset.inputs.map((input) => ({ ...input })),
      name: algorithmPreset.name,
      description: algorithmPreset.description,
      createdAt: algorithmPreset.createdAt,
      updatedAt: algorithmPreset.updatedAt,
    };

    const snapshot: SnapshotCreateData = {
      status: 'queued',
      algorithmPreset: createDto.algorithmPresetId,
      algorithmPresetFrozen: frozenAlgorithmPreset,
      temporal: createDto.temporal,
      outputs: createDto.outputs as SnapshotOutputs | undefined,
    };

    const createdSnapshot = await this.repository.create(snapshot);

    return this.launchSnapshotWorkflow(createdSnapshot);
  }

  /**
   * Starting the workflow is part of the create contract. The deterministic
   * workflow id is persisted before the start call so cancel/delete/reconcile
   * can always reach the run, and a start failure marks the row `failed` and
   * surfaces as a 503 instead of leaving it `queued` forever.
   */
  private async launchSnapshotWorkflow(createdSnapshot: SnapshotRow): Promise<SnapshotRow> {
    const snapshotId = createdSnapshot._id;
    const workflowId = this.temporalService.snapshotWorkflowId(snapshotId);

    const persisted = await this.repository.applyExternalUpdate(snapshotId, {
      temporal: { ...createdSnapshot.temporal, workflowId },
    });

    try {
      this.logger.info({ snapshotId, workflowId }, 'Starting snapshot workflow');
      await this.temporalService.startRunSnapshotWorkflow(snapshotId);
    } catch (error) {
      const err = error as Error;
      this.logger.error({ snapshotId, workflowId }, `Failed to start snapshot workflow: ${err.message}`);
      try {
        await this.applyExternalUpdate({
          snapshotId,
          status: 'failed',
          error: { message: `Failed to start the snapshot workflow: ${err.message}` },
        });
      } catch (markError) {
        this.logger.error(
          { snapshotId },
          `Failed to mark snapshot as failed after a start failure: ${(markError as Error).message}`,
        );
      }
      throw new SnapshotWorkflowStartException();
    }

    return persisted?.row ?? createdSnapshot;
  }

  list(queryDto: ListSnapshotsQueryDto) {
    return this.repository.findAll(
      {
        status: queryDto.status,
        algorithmPresetId: queryDto.algorithmPreset,
        frozenKey: queryDto.key,
        frozenVersion: queryDto.version,
      },
      {
        page: queryDto.page,
        limit: queryDto.limit,
        sortBy: queryDto.sortBy,
      },
    );
  }

  async getById(id: string) {
    const snapshot = await this.repository.findById(id);
    if (!snapshot) {
      throwNotFoundError(id, SNAPSHOT_ENTITY);
    }
    return snapshot;
  }

  findByIdOrNull(id: string): Promise<SnapshotRow | null> {
    return this.repository.findById(id);
  }

  /**
   * Applies an update originating from the Temporal `updateSnapshot` activity.
   *
   * Owns the status-transition side effects:
   *   - `status === 'running'` stamps `startedAt`
   *   - `status` in {`completed`, `failed`, `cancelled`} stamps `completedAt`
   *
   * The repository persists the update and the SSE `pg_notify` in the same
   * transaction so listeners only see committed rows.
   *
   * Returns `null` when the snapshot does not exist; the caller (activity)
   * surfaces that as a non-retryable failure so the workflow stops retrying.
   */
  async applyExternalUpdate(input: UpdateSnapshotInput): Promise<SnapshotRow | null> {
    const data: SnapshotApplyExternalUpdate = {};

    if (input.status !== undefined) {
      data.status = input.status;
      if (input.status === 'running') {
        data.startedAt = new Date();
      } else if (input.status === 'completed' || input.status === 'failed' || input.status === 'cancelled') {
        data.completedAt = new Date();
      }
    }

    if (input.temporal !== undefined) {
      data.temporal = input.temporal;
    }

    if (input.outputs !== undefined) {
      data.outputs = input.outputs;
    }

    if (input.error !== undefined) {
      data.error = {
        ...input.error,
        timestamp: new Date().toISOString(),
      };
    }

    const result = await this.repository.applyExternalUpdate(input.snapshotId, data);
    if (!result) {
      this.logger.warn({ snapshotId: input.snapshotId }, 'Snapshot update skipped — row not found');
      return null;
    }

    if (!result.applied) {
      this.logger.warn(
        { snapshotId: input.snapshotId, currentStatus: result.row.status, requestedStatus: input.status },
        'Snapshot update ignored — status transition not allowed',
      );
      return result.row;
    }

    this.logger.info(
      { snapshotId: input.snapshotId, status: result.row.status },
      'Snapshot updated via Temporal activity',
    );

    return result.row;
  }

  async deleteById(id: string) {
    const snapshot = await this.repository.findById(id);
    if (!snapshot) {
      throwNotFoundError(id, SNAPSHOT_ENTITY);
    }

    if (snapshot.status === 'queued' || snapshot.status === 'running') {
      // Queued rows may already have a started workflow; the derived id also
      // covers rows created before the workflow id was persisted at create.
      const workflowId = snapshot.temporal?.workflowId ?? this.temporalService.snapshotWorkflowId(id);
      this.logger.info({ snapshotId: id, workflowId }, 'Terminating active snapshot workflow before delete');
      await this.temporalService.terminateSnapshotWorkflow(workflowId, true);
    }

    await this.repository.deleteById(id);

    await this.deleteS3Objects(snapshot);
  }

  private async deleteS3Objects(snapshot: SnapshotRow): Promise<void> {
    const keysToDelete: string[] = [];

    try {
      if (snapshot.algorithmPresetFrozen?.inputs) {
        for (const input of snapshot.algorithmPresetFrozen.inputs) {
          if (typeof input.value === 'string' && input.value.startsWith('uploads/')) {
            keysToDelete.push(input.value);
          }
        }
      }

      try {
        const prefix = `snapshots/${snapshot._id}/`;
        const snapshotKeys = await this.storageService.listObjectsByPrefix(prefix);
        keysToDelete.push(...snapshotKeys);
        this.logger.info(`Found ${snapshotKeys.length} objects for snapshot ${snapshot._id}`);
      } catch (error) {
        const err = error as Error;
        this.logger.error(`Failed to list S3 objects for snapshot ${snapshot._id}: ${err.message}`, err.stack);
      }

      if (keysToDelete.length > 0) {
        this.logger.info(`Deleting ${keysToDelete.length} S3 objects for snapshot ${snapshot._id}`);

        const result = await this.storageService.deleteObjects(keysToDelete);

        this.logger.info(`Deleted ${result.deleted.length} S3 objects for snapshot ${snapshot._id}`);

        if (result.errors.length > 0) {
          this.logger.warn(`Failed to delete ${result.errors.length} S3 objects for snapshot ${snapshot._id}`, {
            errors: result.errors,
          });
        }
      } else {
        this.logger.info(`No S3 objects to delete for snapshot ${snapshot._id}`);
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to delete S3 objects for snapshot ${snapshot._id}: ${err.message}`, err.stack);
    }
  }
}
