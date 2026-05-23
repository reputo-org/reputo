import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { validateAlgorithmPreset } from '@reputo/algorithm-validator';
import { getAlgorithmDefinition } from '@reputo/reputation-algorithms';
import type { StorageMetadata } from '@reputo/storage';
import type { DataSource } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlgorithmPresetRepository } from '../../../src/algorithm-preset/algorithm-preset.repository';
import { AlgorithmPresetService } from '../../../src/algorithm-preset/algorithm-preset.service';
import type {
  CreateAlgorithmPresetDto,
  ListAlgorithmPresetsQueryDto,
  UpdateAlgorithmPresetDto,
} from '../../../src/algorithm-preset/dto';
import { StorageInputValidationException } from '../../../src/shared/exceptions';
import type { SnapshotRepository } from '../../../src/snapshot/snapshot.repository';
import type { StorageService } from '../../../src/storage/storage.service';
import type { TemporalService } from '../../../src/temporal';

vi.mock('@reputo/reputation-algorithms', async () => {
  const actual = await vi.importActual('@reputo/reputation-algorithms');
  return {
    ...actual,
    getAlgorithmDefinition: vi.fn(),
  };
});

vi.mock('@reputo/algorithm-validator', async () => {
  const actual = await vi.importActual('@reputo/algorithm-validator');
  return {
    ...actual,
    validateAlgorithmPreset: vi.fn(),
  };
});

const PRESET_ID = '01940000-0000-7000-8000-000000000000';

describe('AlgorithmPresetService', () => {
  let service: AlgorithmPresetService;
  let mockRepository: AlgorithmPresetRepository;
  let mockStorageService: StorageService;
  let mockConfigService: ConfigService;
  let mockSnapshotRepository: SnapshotRepository;
  let mockTemporalService: TemporalService;
  let mockDataSource: DataSource;
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
    setContext: vi.fn(),
  } as unknown as Parameters<typeof AlgorithmPresetService.prototype.constructor>[0];

  const defaultStorageConfig = {
    maxSizeBytes: 52428800,
    contentTypeAllowlist: 'text/csv,text/plain,application/json',
  };

  const mockAlgorithmDefinition = {
    key: 'test_key',
    name: 'Test Algorithm',
    category: 'Test',
    description: 'Test algorithm definition',
    version: '1.0.0',
    inputs: [
      {
        key: 'input1',
        label: 'Input 1',
        description: 'Test input',
        type: 'csv',
        csv: {
          hasHeader: true,
          delimiter: ',',
          columns: [{ key: 'column1', type: 'string', required: true }],
        },
      },
    ],
    outputs: [],
    runtime: { taskQueue: 'test-queue', activity: 'test-activity' },
  };

  const validMetadata: StorageMetadata = {
    filename: 'test.csv',
    ext: 'csv',
    size: 1024,
    contentType: 'text/csv',
    timestamp: Date.now(),
  };

  const validCsvBuffer = Buffer.from('column1\nvalue1\n');

  beforeEach(() => {
    vi.clearAllMocks();

    mockRepository = {
      create: vi.fn(),
      findAll: vi.fn(),
      findById: vi.fn(),
      updateById: vi.fn(),
      deleteById: vi.fn(),
    } as unknown as AlgorithmPresetRepository;

    mockStorageService = {
      getObjectMetadata: vi.fn().mockResolvedValue(validMetadata),
      getObject: vi.fn().mockResolvedValue(validCsvBuffer),
      listObjectsByPrefix: vi.fn().mockResolvedValue([]),
      deleteObjects: vi.fn().mockResolvedValue({ deleted: [], errors: [] }),
    } as unknown as StorageService;

    mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === 'storage.maxSizeBytes') return defaultStorageConfig.maxSizeBytes;
        if (key === 'storage.contentTypeAllowlist') return defaultStorageConfig.contentTypeAllowlist;
        return undefined;
      }),
    } as unknown as ConfigService;

    mockSnapshotRepository = {
      find: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ deletedCount: 0 }),
    } as unknown as SnapshotRepository;

    mockTemporalService = {
      cancelSnapshotWorkflows: vi.fn().mockResolvedValue(undefined),
      terminateSnapshotWorkflows: vi.fn().mockResolvedValue(undefined),
    } as unknown as TemporalService;

    // `dataSource.transaction(cb)` immediately invokes the callback with an
    // empty proxy that re-uses the service's existing repository mocks via
    // passthrough — the same pattern as the old `prisma.$transaction` test
    // double, just now keyed off the TypeORM EntityManager rather than the
    // PrismaClient.
    mockDataSource = {
      transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({})),
    } as unknown as DataSource;

    vi.mocked(getAlgorithmDefinition).mockReturnValue(JSON.stringify(mockAlgorithmDefinition));
    vi.mocked(validateAlgorithmPreset).mockImplementation(async (args) => {
      const typed = args as {
        definition: typeof mockAlgorithmDefinition;
        preset: { inputs: Array<{ key: string; value?: unknown }> };
        resolveInputContent: (input: { input: unknown; value: string }) => Promise<Buffer>;
      };
      const errors: Array<{ field: string; message: string; source: 'file' }> = [];

      for (const input of typed.definition.inputs) {
        if (input.type !== 'csv' && input.type !== 'json') continue;
        const presetInput = typed.preset.inputs.find((candidate) => candidate.key === input.key);
        if (!presetInput || typeof presetInput.value !== 'string' || presetInput.value.trim() === '') {
          continue;
        }
        try {
          await typed.resolveInputContent({ input, value: presetInput.value });
        } catch (error) {
          const messages =
            error instanceof AggregateError
              ? error.errors.map((item) => (item instanceof Error ? item.message : String(item)))
              : [error instanceof Error ? error.message : String(error)];
          errors.push(...messages.map((message) => ({ field: input.key, message, source: 'file' as const })));
        }
      }

      if (errors.length > 0) {
        return { success: false, errors };
      }
      return { success: true, data: { preset: {}, payload: {} } };
    });

    service = new AlgorithmPresetService(
      mockLogger,
      mockRepository,
      mockStorageService,
      mockSnapshotRepository,
      mockTemporalService,
      mockDataSource,
      mockConfigService,
    );
  });

  describe('create', () => {
    it('delegates to repository.create with the DTO', async () => {
      const createDto: CreateAlgorithmPresetDto = {
        key: 'test_key',
        version: '1.0.0',
        inputs: [{ key: 'input1', value: 'uploads/test.csv' }],
      };
      const mockPreset = { _id: PRESET_ID, ...createDto };
      mockRepository.create = vi.fn().mockResolvedValue(mockPreset);

      const result = await service.create(createDto);

      expect(mockRepository.create).toHaveBeenCalledOnce();
      expect(mockRepository.create).toHaveBeenCalledWith(createDto);
      expect(result).toBe(mockPreset);
    });

    it('rejects stale presets via the validator pipeline', async () => {
      vi.mocked(validateAlgorithmPreset).mockResolvedValueOnce({
        success: false,
        errors: [
          {
            field: 'selected_targets',
            message: 'Input not supported. Recreate the preset.',
            source: 'definition',
          },
        ],
      });

      await expect(
        service.create({
          key: 'test_key',
          version: '1.0.0',
          inputs: [{ key: 'selected_targets', value: [] }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('list', () => {
    it('forwards key/version into the structured repository filter', async () => {
      const queryDto: ListAlgorithmPresetsQueryDto = {
        key: 'test_key',
        version: '1.0.0',
        page: 1,
        limit: 10,
        sortBy: 'createdAt:desc',
      };
      mockRepository.findAll = vi
        .fn()
        .mockResolvedValue({ results: [], totalResults: 0, page: 1, limit: 10, totalPages: 0 });

      await service.list(queryDto);

      expect(mockRepository.findAll).toHaveBeenCalledWith(
        { key: 'test_key', version: '1.0.0' },
        { page: 1, limit: 10, sortBy: 'createdAt:desc' },
      );
    });
  });

  describe('getById', () => {
    it('returns the row when present', async () => {
      const row = { _id: PRESET_ID, key: 'k', version: '1.0.0', inputs: [] };
      mockRepository.findById = vi.fn().mockResolvedValue(row);

      const result = await service.getById(PRESET_ID);

      expect(result).toBe(row);
    });

    it('throws NotFoundException when missing', async () => {
      mockRepository.findById = vi.fn().mockResolvedValue(null);

      await expect(service.getById(PRESET_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateById', () => {
    it('validates against the original key/version then updates', async () => {
      const updateDto: UpdateAlgorithmPresetDto = { name: 'Updated', description: 'Updated description' };
      mockRepository.findById = vi.fn().mockResolvedValue({
        _id: PRESET_ID,
        key: 'test_key',
        version: '1.0.0',
        inputs: [{ key: 'input1', value: 'uploads/test.csv' }],
      });
      mockRepository.updateById = vi.fn().mockResolvedValue({ _id: PRESET_ID, ...updateDto });

      const result = await service.updateById(PRESET_ID, updateDto);

      expect(mockStorageService.getObjectMetadata).toHaveBeenCalledWith('uploads/test.csv');
      expect(mockRepository.updateById).toHaveBeenCalledWith(PRESET_ID, updateDto);
      expect((result as { _id: string })._id).toBe(PRESET_ID);
    });

    it('throws NotFoundException when the preset is missing', async () => {
      mockRepository.findById = vi.fn().mockResolvedValue(null);

      await expect(service.updateById(PRESET_ID, { name: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deleteById', () => {
    it('runs the snapshot deleteMany + preset deleteById inside `dataSource.transaction`', async () => {
      const preset = { _id: PRESET_ID, key: 'k', version: '1', inputs: [] };
      const snapshots = [{ _id: 's1', status: 'completed', algorithmPresetFrozen: { inputs: [] } }];

      mockRepository.findById = vi.fn().mockResolvedValue(preset);
      mockSnapshotRepository.find = vi.fn().mockResolvedValue(snapshots);
      mockRepository.deleteById = vi.fn().mockResolvedValue(preset);
      mockSnapshotRepository.deleteMany = vi.fn().mockResolvedValue({ deletedCount: 1 });

      await service.deleteById(PRESET_ID);

      expect(mockSnapshotRepository.find).toHaveBeenCalledWith({ algorithmPresetId: PRESET_ID });
      expect(mockTemporalService.terminateSnapshotWorkflows).toHaveBeenCalledWith(snapshots, true);
      expect(mockDataSource.transaction).toHaveBeenCalledOnce();
      expect(mockSnapshotRepository.deleteMany).toHaveBeenCalledWith(
        { algorithmPresetId: PRESET_ID },
        expect.anything(),
      );
      expect(mockRepository.deleteById).toHaveBeenCalledWith(PRESET_ID, expect.anything());
    });

    it('skips snapshot deleteMany when there are no snapshots', async () => {
      mockRepository.findById = vi.fn().mockResolvedValue({ _id: PRESET_ID, inputs: [] });
      mockSnapshotRepository.find = vi.fn().mockResolvedValue([]);
      mockRepository.deleteById = vi.fn().mockResolvedValue({ _id: PRESET_ID });

      await service.deleteById(PRESET_ID);

      expect(mockSnapshotRepository.deleteMany).not.toHaveBeenCalled();
      expect(mockRepository.deleteById).toHaveBeenCalled();
    });

    it('cleans up S3 keys from preset inputs and snapshot prefixes', async () => {
      const preset = {
        _id: PRESET_ID,
        inputs: [
          { key: 'votes', value: 'uploads/uuid-1/votes.csv' },
          { key: 'config', value: 'some-value' },
        ],
      };
      const snapshots = [
        { _id: 's1', status: 'completed', algorithmPresetFrozen: { inputs: [] } },
        { _id: 's2', status: 'running', temporal: { workflowId: 'wf-1' }, algorithmPresetFrozen: { inputs: [] } },
      ];
      mockRepository.findById = vi.fn().mockResolvedValue(preset);
      mockSnapshotRepository.find = vi.fn().mockResolvedValue(snapshots);
      mockRepository.deleteById = vi.fn().mockResolvedValue(preset);
      mockStorageService.listObjectsByPrefix = vi
        .fn()
        .mockResolvedValueOnce(['snapshots/s1/output1.csv'])
        .mockResolvedValueOnce(['snapshots/s2/output2.json']);
      mockStorageService.deleteObjects = vi.fn().mockResolvedValue({
        deleted: ['uploads/uuid-1/votes.csv', 'snapshots/s1/output1.csv', 'snapshots/s2/output2.json'],
        errors: [],
      });

      await service.deleteById(PRESET_ID);

      expect(mockStorageService.deleteObjects).toHaveBeenCalledWith([
        'uploads/uuid-1/votes.csv',
        'snapshots/s1/output1.csv',
        'snapshots/s2/output2.json',
      ]);
    });

    it('throws NotFoundException when the preset is missing', async () => {
      mockRepository.findById = vi.fn().mockResolvedValue(null);

      await expect(service.deleteById(PRESET_ID)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('does not fail the delete when S3 cleanup throws', async () => {
      mockRepository.findById = vi.fn().mockResolvedValue({ _id: PRESET_ID, inputs: [] });
      mockSnapshotRepository.find = vi.fn().mockResolvedValue([]);
      mockRepository.deleteById = vi.fn().mockResolvedValue({ _id: PRESET_ID });
      mockStorageService.deleteObjects = vi.fn().mockRejectedValue(new Error('S3 error'));

      await expect(service.deleteById(PRESET_ID)).resolves.not.toThrow();
    });
  });

  describe('storage validation', () => {
    it('throws StorageInputValidationException when content type is wrong', async () => {
      const createDto: CreateAlgorithmPresetDto = {
        key: 'test_key',
        version: '1.0.0',
        inputs: [{ key: 'input1', value: 'uploads/test.csv' }],
      };
      mockStorageService.getObjectMetadata = vi
        .fn()
        .mockResolvedValue({ ...validMetadata, contentType: 'application/json' });

      await expect(service.create(createDto)).rejects.toThrow(StorageInputValidationException);
    });
  });
});
