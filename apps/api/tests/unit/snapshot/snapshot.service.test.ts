import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { validateAlgorithmPreset } from '@reputo/algorithm-validator';
import { getAlgorithmDefinition } from '@reputo/reputation-algorithms';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlgorithmPresetRepository } from '../../../src/algorithm-preset/algorithm-preset.repository';
import type { CreateSnapshotDto, ListSnapshotsQueryDto } from '../../../src/snapshot/dto';
import type { SnapshotRepository } from '../../../src/snapshot/snapshot.repository';
import { SnapshotService } from '../../../src/snapshot/snapshot.service';
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
const SNAPSHOT_ID = '01940000-0000-7000-8000-000000000001';

describe('SnapshotService', () => {
  let service: SnapshotService;
  let mockSnapshotRepository: SnapshotRepository;
  let mockAlgorithmPresetRepository: AlgorithmPresetRepository;
  let mockTemporalService: {
    startSnapshotWorkflow: ReturnType<typeof vi.fn>;
    cancelSnapshotWorkflow: ReturnType<typeof vi.fn>;
    terminateSnapshotWorkflow: ReturnType<typeof vi.fn>;
  };
  let mockStorageService: StorageService;
  let mockConfigService: ConfigService;
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
    setContext: vi.fn(),
  } as unknown as Parameters<typeof SnapshotService.prototype.constructor>[0];

  beforeEach(() => {
    vi.clearAllMocks();

    mockSnapshotRepository = {
      create: vi.fn(),
      findAll: vi.fn(),
      findById: vi.fn(),
      find: vi.fn(),
      deleteById: vi.fn(),
      deleteMany: vi.fn(),
      applyExternalUpdate: vi.fn(),
    } as unknown as SnapshotRepository;

    mockAlgorithmPresetRepository = {
      findById: vi.fn(),
      findAll: vi.fn(),
    } as unknown as AlgorithmPresetRepository;

    mockTemporalService = {
      startSnapshotWorkflow: vi.fn().mockResolvedValue(undefined),
      cancelSnapshotWorkflow: vi.fn().mockResolvedValue(undefined),
      terminateSnapshotWorkflow: vi.fn().mockResolvedValue(undefined),
    };

    mockStorageService = {
      getObjectMetadata: vi.fn(),
      getObject: vi.fn(),
      listObjectsByPrefix: vi.fn().mockResolvedValue([]),
      deleteObjects: vi.fn().mockResolvedValue({ deleted: [], errors: [] }),
    } as unknown as StorageService;

    mockConfigService = {
      get: vi.fn((key: string) => {
        if (key === 'storage.maxSizeBytes') return 52428800;
        if (key === 'storage.contentTypeAllowlist') return 'text/csv,text/plain,application/json';
        return undefined;
      }),
    } as unknown as ConfigService;

    vi.mocked(getAlgorithmDefinition).mockReturnValue(
      JSON.stringify({
        key: 'test_key',
        name: 'Test Algorithm',
        category: 'Activity',
        summary: 'Test',
        description: 'Test algorithm',
        version: '1.0.0',
        inputs: [],
        outputs: [],
        runtime: 'typescript',
      }),
    );
    vi.mocked(validateAlgorithmPreset).mockResolvedValue({
      success: true,
      data: { preset: {}, payload: {} },
    });

    service = new SnapshotService(
      mockLogger,
      mockSnapshotRepository,
      mockAlgorithmPresetRepository,
      mockTemporalService as unknown as TemporalService,
      mockStorageService,
      mockConfigService,
    );
  });

  describe('create', () => {
    it('freezes only the required preset fields and starts the workflow', async () => {
      const createDto: CreateSnapshotDto = { algorithmPresetId: PRESET_ID };
      const algorithmPreset = {
        _id: PRESET_ID,
        key: 'test_key',
        version: '1.0.0',
        inputs: [{ key: 'param1', value: 'value1' }],
        name: 'Test Preset',
        description: 'Description for the preset',
        createdAt: new Date('2026-05-21T00:00:00Z'),
        updatedAt: new Date('2026-05-21T00:00:00Z'),
      };
      const snapshot = {
        _id: SNAPSHOT_ID,
        algorithmPreset: PRESET_ID,
        algorithmPresetFrozen: { key: 'test_key', version: '1.0.0', inputs: algorithmPreset.inputs },
        status: 'queued',
      };

      mockAlgorithmPresetRepository.findById = vi.fn().mockResolvedValue(algorithmPreset);
      mockSnapshotRepository.create = vi.fn().mockResolvedValue(snapshot);

      const result = await service.create(createDto);

      expect(mockAlgorithmPresetRepository.findById).toHaveBeenCalledWith(PRESET_ID);
      const createArg = (mockSnapshotRepository.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createArg.algorithmPreset).toBe(PRESET_ID);
      expect(createArg.algorithmPresetFrozen.key).toBe('test_key');
      expect(createArg.algorithmPresetFrozen.version).toBe('1.0.0');
      expect(createArg.algorithmPresetFrozen.inputs).toEqual(algorithmPreset.inputs);
      expect(createArg.algorithmPresetFrozen.name).toBe('Test Preset');
      expect(createArg.algorithmPresetFrozen.description).toBe('Description for the preset');
      expect(createArg.algorithmPresetFrozen.createdAt).toBe(algorithmPreset.createdAt);
      expect(createArg.algorithmPresetFrozen.updatedAt).toBe(algorithmPreset.updatedAt);
      expect(mockTemporalService.startSnapshotWorkflow).toHaveBeenCalledWith(SNAPSHOT_ID);
      expect(result).toBe(snapshot);
    });

    it('throws NotFoundException when the preset does not exist', async () => {
      mockAlgorithmPresetRepository.findById = vi.fn().mockResolvedValue(null);

      await expect(service.create({ algorithmPresetId: PRESET_ID })).rejects.toBeInstanceOf(NotFoundException);
    });

    it('forwards optional temporal/outputs through to the repository', async () => {
      const createDto: CreateSnapshotDto = {
        algorithmPresetId: PRESET_ID,
        temporal: { workflowId: 'wf-1' },
        outputs: { csv: 'key' },
      };
      mockAlgorithmPresetRepository.findById = vi.fn().mockResolvedValue({
        _id: PRESET_ID,
        key: 'k',
        version: '1.0.0',
        inputs: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockSnapshotRepository.create = vi.fn().mockResolvedValue({ _id: SNAPSHOT_ID });

      await service.create(createDto);

      const createArg = (mockSnapshotRepository.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(createArg.temporal).toEqual({ workflowId: 'wf-1' });
      expect(createArg.outputs).toEqual({ csv: 'key' });
    });
  });

  describe('list', () => {
    it('translates the query DTO into the structured repository filter', async () => {
      const queryDto: ListSnapshotsQueryDto = {
        status: 'queued',
        algorithmPreset: PRESET_ID,
        key: 'test_key',
        version: '1.0.0',
        page: 2,
        limit: 5,
        sortBy: 'createdAt:asc',
      };
      mockSnapshotRepository.findAll = vi.fn().mockResolvedValue({
        results: [],
        totalResults: 0,
        page: 2,
        limit: 5,
        totalPages: 0,
      });

      await service.list(queryDto);

      expect(mockSnapshotRepository.findAll).toHaveBeenCalledWith(
        {
          status: 'queued',
          algorithmPresetId: PRESET_ID,
          frozenKey: 'test_key',
          frozenVersion: '1.0.0',
        },
        { page: 2, limit: 5, sortBy: 'createdAt:asc' },
      );
    });
  });

  describe('getById', () => {
    it('returns the snapshot when found', async () => {
      const snapshot = { _id: SNAPSHOT_ID, algorithmPreset: PRESET_ID, status: 'queued' };
      mockSnapshotRepository.findById = vi.fn().mockResolvedValue(snapshot);

      await expect(service.getById(SNAPSHOT_ID)).resolves.toBe(snapshot);
    });

    it('throws NotFoundException when missing', async () => {
      mockSnapshotRepository.findById = vi.fn().mockResolvedValue(null);

      await expect(service.getById(SNAPSHOT_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findByIdOrNull', () => {
    it('delegates to the repository and returns null when missing', async () => {
      mockSnapshotRepository.findById = vi.fn().mockResolvedValue(null);

      await expect(service.findByIdOrNull(SNAPSHOT_ID)).resolves.toBeNull();
      expect(mockSnapshotRepository.findById).toHaveBeenCalledWith(SNAPSHOT_ID);
    });

    it('returns the row without throwing when found', async () => {
      const row = { _id: SNAPSHOT_ID, status: 'queued' };
      mockSnapshotRepository.findById = vi.fn().mockResolvedValue(row);

      await expect(service.findByIdOrNull(SNAPSHOT_ID)).resolves.toBe(row);
    });
  });

  describe('applyExternalUpdate', () => {
    function captureApplyArgs(): Promise<{ id: string; data: Record<string, unknown> }> {
      return new Promise((resolve) => {
        mockSnapshotRepository.applyExternalUpdate = vi.fn().mockImplementation(async (id, data) => {
          resolve({ id, data });
          return { _id: id, status: data.status ?? 'queued' };
        });
      });
    }

    it('stamps startedAt when status transitions to running', async () => {
      const applyArgs = captureApplyArgs();

      await service.applyExternalUpdate({ snapshotId: SNAPSHOT_ID, status: 'running' });
      const { id, data } = await applyArgs;

      expect(id).toBe(SNAPSHOT_ID);
      expect(data.status).toBe('running');
      expect(data.startedAt).toBeInstanceOf(Date);
      expect(data.completedAt).toBeUndefined();
    });

    it.each([
      'completed',
      'failed',
      'cancelled',
    ] as const)('stamps completedAt when status becomes %s', async (status) => {
      const applyArgs = captureApplyArgs();

      await service.applyExternalUpdate({ snapshotId: SNAPSHOT_ID, status });
      const { data } = await applyArgs;

      expect(data.status).toBe(status);
      expect(data.completedAt).toBeInstanceOf(Date);
      expect(data.startedAt).toBeUndefined();
    });

    it('forwards temporal/outputs/error payloads and adds an error timestamp', async () => {
      const applyArgs = captureApplyArgs();

      await service.applyExternalUpdate({
        snapshotId: SNAPSHOT_ID,
        temporal: { workflowId: 'wf-1' },
        outputs: { csv: 'snapshots/x.csv' },
        error: { message: 'boom' },
      });
      const { data } = await applyArgs;

      expect(data.temporal).toEqual({ workflowId: 'wf-1' });
      expect(data.outputs).toEqual({ csv: 'snapshots/x.csv' });
      const errorPayload = data.error as { message: string; timestamp: string };
      expect(errorPayload.message).toBe('boom');
      expect(typeof errorPayload.timestamp).toBe('string');
    });

    it('returns null when the snapshot is missing (does not throw)', async () => {
      mockSnapshotRepository.applyExternalUpdate = vi.fn().mockResolvedValue(null);

      await expect(service.applyExternalUpdate({ snapshotId: SNAPSHOT_ID, status: 'completed' })).resolves.toBeNull();
    });

    it('is idempotent: same input twice produces the same persisted data shape', async () => {
      const calls: Record<string, unknown>[] = [];
      mockSnapshotRepository.applyExternalUpdate = vi.fn().mockImplementation(async (_id, data) => {
        calls.push({ ...data });
        return { _id: SNAPSHOT_ID, status: data.status ?? 'queued' };
      });

      const input = {
        snapshotId: SNAPSHOT_ID,
        status: 'completed' as const,
        outputs: { csv: 'snapshots/out.csv' },
      };
      await service.applyExternalUpdate(input);
      await service.applyExternalUpdate(input);

      expect(calls).toHaveLength(2);
      expect(calls[0].status).toBe('completed');
      expect(calls[1].status).toBe('completed');
      expect(calls[0].outputs).toEqual(calls[1].outputs);
    });
  });

  describe('deleteById', () => {
    it('deletes the snapshot when status is not running', async () => {
      mockSnapshotRepository.findById = vi.fn().mockResolvedValue({
        _id: SNAPSHOT_ID,
        status: 'completed',
        algorithmPresetFrozen: { inputs: [] },
      });
      mockSnapshotRepository.deleteById = vi.fn().mockResolvedValue({ _id: SNAPSHOT_ID });

      await service.deleteById(SNAPSHOT_ID);

      expect(mockTemporalService.terminateSnapshotWorkflow).not.toHaveBeenCalled();
      expect(mockSnapshotRepository.deleteById).toHaveBeenCalledWith(SNAPSHOT_ID);
    });

    it('terminates the workflow first when the snapshot is running', async () => {
      mockSnapshotRepository.findById = vi.fn().mockResolvedValue({
        _id: SNAPSHOT_ID,
        status: 'running',
        temporal: { workflowId: 'wf-1' },
        algorithmPresetFrozen: { inputs: [] },
      });
      mockSnapshotRepository.deleteById = vi.fn().mockResolvedValue({ _id: SNAPSHOT_ID });

      await service.deleteById(SNAPSHOT_ID);

      expect(mockTemporalService.terminateSnapshotWorkflow).toHaveBeenCalledWith('wf-1', true);
      expect(mockSnapshotRepository.deleteById).toHaveBeenCalledWith(SNAPSHOT_ID);
    });

    it('throws NotFoundException when missing', async () => {
      mockSnapshotRepository.findById = vi.fn().mockResolvedValue(null);

      await expect(service.deleteById(SNAPSHOT_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
