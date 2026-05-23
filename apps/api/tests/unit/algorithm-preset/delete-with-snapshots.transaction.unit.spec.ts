import type { DataSource } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlgorithmPresetRepository } from '../../../src/algorithm-preset/algorithm-preset.repository';
import { AlgorithmPresetService } from '../../../src/algorithm-preset/algorithm-preset.service';
import { SnapshotRepository } from '../../../src/snapshot/snapshot.repository';
import type { StorageService } from '../../../src/storage/storage.service';
import type { TemporalService } from '../../../src/temporal';

// Focused unit test for `AlgorithmPresetService.deletePresetWithSnapshots`.
// Verifies that snapshot `deleteMany` and preset `deleteById` are executed
// inside the same `dataSource.transaction` and that the snapshot deletion
// happens before the preset deletion (the FK in `snapshot.algorithm_preset_id`
// is `RESTRICT`, so reversing the order would fail at the DB level).

const PRESET_ID = '01940000-0000-7000-8000-000000000000';

describe('AlgorithmPresetService.deletePresetWithSnapshots (transaction)', () => {
  let service: AlgorithmPresetService;
  let mockSnapshotRepository: SnapshotRepository;
  let mockPresetRepository: AlgorithmPresetRepository;
  let mockDataSource: DataSource;
  let transactionCallback: ((manager: unknown) => Promise<unknown>) | null = null;
  let callOrder: string[];

  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
    setContext: vi.fn(),
  } as unknown as Parameters<typeof AlgorithmPresetService.prototype.constructor>[0];

  beforeEach(() => {
    vi.clearAllMocks();
    callOrder = [];
    transactionCallback = null;

    mockSnapshotRepository = {
      find: vi.fn().mockResolvedValue([{ _id: 's1' }, { _id: 's2' }]),
      deleteMany: vi.fn(async () => {
        callOrder.push('snapshot.deleteMany');
        return { deletedCount: 2 };
      }),
    } as unknown as SnapshotRepository;

    mockPresetRepository = {
      findById: vi.fn().mockResolvedValue({ _id: PRESET_ID, inputs: [] }),
      deleteById: vi.fn(async () => {
        callOrder.push('algorithmPreset.deleteById');
        return { _id: PRESET_ID };
      }),
    } as unknown as AlgorithmPresetRepository;

    // Sentinel object stands in for the TypeORM `EntityManager`. We don't
    // need a real one; the service only forwards it into the repository
    // methods we already mocked, and we want to assert that the same object
    // ends up at both stops.
    const sentinelManager = { __isTransactionalManager: true };
    mockDataSource = {
      transaction: vi.fn(async (cb: (manager: unknown) => Promise<unknown>) => {
        transactionCallback = cb;
        return cb(sentinelManager);
      }),
    } as unknown as DataSource;

    const mockStorage = {
      listObjectsByPrefix: vi.fn().mockResolvedValue([]),
      deleteObjects: vi.fn().mockResolvedValue({ deleted: [], errors: [] }),
    } as unknown as StorageService;

    const mockTemporal = {
      terminateSnapshotWorkflows: vi.fn().mockResolvedValue(undefined),
    } as unknown as TemporalService;

    const mockConfig = {
      get: vi.fn().mockReturnValue(undefined),
    } as unknown as Parameters<typeof AlgorithmPresetService.prototype.constructor>[6];

    service = new AlgorithmPresetService(
      mockLogger,
      mockPresetRepository,
      mockStorage,
      mockSnapshotRepository,
      mockTemporal,
      mockDataSource,
      mockConfig,
    );
  });

  it('executes snapshot.deleteMany and algorithmPreset.delete inside a single transaction', async () => {
    await service.deleteById(PRESET_ID);

    expect(mockDataSource.transaction).toHaveBeenCalledOnce();
    expect(transactionCallback).toBeTypeOf('function');
    expect(callOrder).toEqual(['snapshot.deleteMany', 'algorithmPreset.deleteById']);
  });

  it('passes the transactional manager through to both repositories', async () => {
    await service.deleteById(PRESET_ID);

    expect(mockSnapshotRepository.deleteMany).toHaveBeenCalledWith(
      { algorithmPresetId: PRESET_ID },
      expect.objectContaining({ __isTransactionalManager: true }),
    );
    expect(mockPresetRepository.deleteById).toHaveBeenCalledWith(
      PRESET_ID,
      expect.objectContaining({ __isTransactionalManager: true }),
    );
  });

  it('skips snapshot.deleteMany when there are no snapshots, but still deletes the preset', async () => {
    mockSnapshotRepository.find = vi.fn().mockResolvedValue([]);

    await service.deleteById(PRESET_ID);

    expect(mockSnapshotRepository.deleteMany).not.toHaveBeenCalled();
    expect(mockPresetRepository.deleteById).toHaveBeenCalled();
    expect(callOrder).toEqual(['algorithmPreset.deleteById']);
  });
});
