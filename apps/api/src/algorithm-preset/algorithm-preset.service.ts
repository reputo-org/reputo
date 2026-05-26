import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import { throwNotFoundError } from '../shared/exceptions';
import { getAlgorithmDefinitionOrThrow, validateAlgorithmInputs } from '../shared/utils';
import type { SnapshotRow } from '../snapshot/snapshot.repository';
import { SnapshotRepository } from '../snapshot/snapshot.repository';
import { StorageService } from '../storage/storage.service';
import { TemporalService } from '../temporal';
import type { AlgorithmPresetRow } from './algorithm-preset.repository';
import { AlgorithmPresetRepository } from './algorithm-preset.repository';
import type { CreateAlgorithmPresetDto, ListAlgorithmPresetsQueryDto, UpdateAlgorithmPresetDto } from './dto';

const ALGORITHM_PRESET_ENTITY = 'AlgorithmPreset';

@Injectable()
export class AlgorithmPresetService {
  private readonly storageMaxSizeBytes: number;
  private readonly storageContentTypeAllowlist: string;

  constructor(
    @InjectPinoLogger(AlgorithmPresetService.name)
    private readonly logger: PinoLogger,
    private readonly repository: AlgorithmPresetRepository,
    private readonly storageService: StorageService,
    @Inject(forwardRef(() => SnapshotRepository))
    private readonly snapshotRepository: SnapshotRepository,
    private readonly temporalService: TemporalService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    configService: ConfigService,
  ) {
    this.storageMaxSizeBytes = configService.get<number>('storage.maxSizeBytes') as number;
    this.storageContentTypeAllowlist = configService.get<string>('storage.contentTypeAllowlist') as string;
  }

  async create(createDto: CreateAlgorithmPresetDto) {
    const algorithmDefinition = getAlgorithmDefinitionOrThrow(createDto.key, createDto.version);
    await validateAlgorithmInputs({
      definition: algorithmDefinition,
      inputs: createDto.inputs,
      storageService: this.storageService,
      storageMaxSizeBytes: this.storageMaxSizeBytes,
      storageContentTypeAllowlist: this.storageContentTypeAllowlist,
    });

    return this.repository.create(createDto);
  }

  list(queryDto: ListAlgorithmPresetsQueryDto) {
    return this.repository.findAll(
      {
        key: queryDto.key,
        version: queryDto.version,
      },
      {
        page: queryDto.page,
        limit: queryDto.limit,
        sortBy: queryDto.sortBy,
      },
    );
  }

  async getById(id: string) {
    const algorithmPreset = await this.repository.findById(id);

    if (!algorithmPreset) {
      throwNotFoundError(id, ALGORITHM_PRESET_ENTITY);
    }
    return algorithmPreset;
  }

  async updateById(id: string, updateDto: UpdateAlgorithmPresetDto) {
    const existingAlgorithmPreset = await this.repository.findById(id);
    if (!existingAlgorithmPreset) {
      throwNotFoundError(id, ALGORITHM_PRESET_ENTITY);
    }

    const mergedPreset = {
      ...existingAlgorithmPreset,
      ...updateDto,
      inputs: updateDto.inputs ?? existingAlgorithmPreset.inputs,
    };

    const algorithmDefinition = getAlgorithmDefinitionOrThrow(
      existingAlgorithmPreset.key,
      existingAlgorithmPreset.version,
    );
    await validateAlgorithmInputs({
      definition: algorithmDefinition,
      inputs: mergedPreset.inputs,
      storageService: this.storageService,
      storageMaxSizeBytes: this.storageMaxSizeBytes,
      storageContentTypeAllowlist: this.storageContentTypeAllowlist,
    });

    const updatedAlgorithmPreset = await this.repository.updateById(id, updateDto);
    if (!updatedAlgorithmPreset) {
      throwNotFoundError(id, ALGORITHM_PRESET_ENTITY);
    }
    return updatedAlgorithmPreset;
  }

  async deleteById(id: string) {
    const algorithmPreset = await this.repository.findById(id);
    if (!algorithmPreset) {
      throwNotFoundError(id, ALGORITHM_PRESET_ENTITY);
    }
    const snapshots = await this.snapshotRepository.find({ algorithmPresetId: id });

    await this.temporalService.terminateSnapshotWorkflows(snapshots, true);

    await this.deletePresetWithSnapshots(id, snapshots.length);

    await this.deleteS3Objects(algorithmPreset, snapshots);
  }

  private async deletePresetWithSnapshots(presetId: string, snapshotCount: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      if (snapshotCount > 0) {
        await this.snapshotRepository.deleteMany({ algorithmPresetId: presetId }, manager);
        this.logger.info(`Deleted ${snapshotCount} snapshots for algorithm preset ${presetId}`);
      }
      await this.repository.deleteById(presetId, manager);
      this.logger.info(`Deleted algorithm preset ${presetId}`);
    });
  }

  private async deleteS3Objects(algorithmPreset: AlgorithmPresetRow, snapshots: SnapshotRow[]): Promise<void> {
    const keysToDelete: string[] = [];

    try {
      for (const input of algorithmPreset.inputs) {
        if (typeof input.value === 'string' && input.value.startsWith('uploads/')) {
          keysToDelete.push(input.value);
        }
      }

      for (const snapshot of snapshots) {
        try {
          const prefix = `snapshots/${snapshot._id}/`;
          const snapshotKeys = await this.storageService.listObjectsByPrefix(prefix);
          keysToDelete.push(...snapshotKeys);
          this.logger.info(`Found ${snapshotKeys.length} objects for snapshot ${snapshot._id}`);
        } catch (error) {
          const err = error as Error;
          this.logger.error(`Failed to list S3 objects for snapshot ${snapshot._id}: ${err.message}`, err.stack);
        }
      }

      if (keysToDelete.length > 0) {
        this.logger.info(`Deleting ${keysToDelete.length} S3 objects for algorithm preset ${algorithmPreset._id}`);

        const result = await this.storageService.deleteObjects(keysToDelete);

        this.logger.info(`Deleted ${result.deleted.length} S3 objects for algorithm preset ${algorithmPreset._id}`);

        if (result.errors.length > 0) {
          this.logger.warn(
            `Failed to delete ${result.errors.length} S3 objects for algorithm preset ${algorithmPreset._id}`,
            { errors: result.errors },
          );
        }
      } else {
        this.logger.info(`No S3 objects to delete for algorithm preset ${algorithmPreset._id}`);
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(
        `Failed to delete S3 objects for algorithm preset ${algorithmPreset._id}: ${err.message}`,
        err.stack,
      );
    }
  }
}
