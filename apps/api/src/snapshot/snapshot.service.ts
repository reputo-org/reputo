import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { UpdateSnapshotInput } from '@reputo/contracts';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AlgorithmPresetRepository } from '../algorithm-preset/algorithm-preset.repository';
import { throwNotFoundError } from '../shared/exceptions';
import { getAlgorithmDefinitionOrThrow, validateAlgorithmInputs } from '../shared/utils';
import { StorageService } from '../storage/storage.service';
import { TemporalService } from '../temporal';
import type { CreateSnapshotDto, ListSnapshotsQueryDto } from './dto';
import type { AlgorithmPresetFrozen, SnapshotCreateData, SnapshotOutputs, SnapshotRow } from './snapshot.repository';
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

    this.logger.info({ snapshotId: createdSnapshot._id }, 'Starting snapshot workflow');
    void this.temporalService.startSnapshotWorkflow(createdSnapshot._id);

    return createdSnapshot;
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
    const data: Prisma.SnapshotUpdateInput = {};

    if (input.status !== undefined) {
      data.status = input.status;
      if (input.status === 'running') {
        data.startedAt = new Date();
      } else if (input.status === 'completed' || input.status === 'failed' || input.status === 'cancelled') {
        data.completedAt = new Date();
      }
    }

    if (input.temporal !== undefined) {
      data.temporal = input.temporal as unknown as Prisma.InputJsonValue;
    }

    if (input.outputs !== undefined) {
      data.outputs = input.outputs as unknown as Prisma.InputJsonValue;
    }

    if (input.error !== undefined) {
      data.error = {
        ...input.error,
        timestamp: new Date().toISOString(),
      } as unknown as Prisma.InputJsonValue;
    }

    const updated = await this.repository.applyExternalUpdate(input.snapshotId, data);
    if (updated) {
      this.logger.info(
        { snapshotId: input.snapshotId, status: updated.status },
        'Snapshot updated via Temporal activity',
      );
    } else {
      this.logger.warn({ snapshotId: input.snapshotId }, 'Snapshot update skipped — row not found');
    }

    return updated;
  }

  async deleteById(id: string) {
    const snapshot = await this.repository.findById(id);
    if (!snapshot) {
      throwNotFoundError(id, SNAPSHOT_ENTITY);
    }

    // Step 1: Terminate workflow and wait for it to fully stop
    if (snapshot.status === 'running' && snapshot.temporal?.workflowId) {
      this.logger.info(
        { snapshotId: id, workflowId: snapshot.temporal.workflowId },
        'Terminating running snapshot workflow before delete',
      );
      await this.temporalService.terminateSnapshotWorkflow(
        snapshot.temporal.workflowId,
        true, // Wait for termination to complete
      );
    }

    // Step 2: Delete from database
    await this.repository.deleteById(id);

    // Step 3: Clean up S3 (workflow is now guaranteed to be stopped)
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
