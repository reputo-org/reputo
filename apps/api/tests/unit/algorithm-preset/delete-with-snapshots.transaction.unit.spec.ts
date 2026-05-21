import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlgorithmPresetRepository } from '../../../src/algorithm-preset/algorithm-preset.repository';
import { AlgorithmPresetService } from '../../../src/algorithm-preset/algorithm-preset.service';
import type { PrismaService } from '../../../src/persistence';
import { SnapshotRepository } from '../../../src/snapshot/snapshot.repository';
import type { StorageService } from '../../../src/storage/storage.service';
import type { TemporalService } from '../../../src/temporal';

// Focused unit test for `AlgorithmPresetService.deletePresetWithSnapshots`.
// Verifies that snapshot `deleteMany` and preset `delete` are executed inside
// the same `prisma.$transaction` and that the snapshot deletion happens before
// the preset deletion (the FK in `snapshot.algorithm_preset_id` is `Restrict`
// so reversing the order would fail at the DB level).

const PRESET_ID = '01940000-0000-7000-8000-000000000000';

describe('AlgorithmPresetService.deletePresetWithSnapshots (transaction)', () => {
  let service: AlgorithmPresetService;
  let mockSnapshotRepository: SnapshotRepository;
  let mockPresetRepository: AlgorithmPresetRepository;
  let mockPrisma: PrismaService;
  let transactionCallback: ((tx: unknown) => Promise<unknown>) | null = null;
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

    const sentinelTx = { __isTransactionClient: true };
    mockPrisma = {
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
        transactionCallback = cb;
        return cb(sentinelTx);
      }),
    } as unknown as PrismaService;

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
      mockPrisma,
      mockConfig,
    );
  });

  it('executes snapshot.deleteMany and algorithmPreset.delete inside a single $transaction', async () => {
    await service.deleteById(PRESET_ID);

    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
    expect(transactionCallback).toBeTypeOf('function');
    expect(callOrder).toEqual(['snapshot.deleteMany', 'algorithmPreset.deleteById']);
  });

  it('passes the transactional client through to both repositories', async () => {
    await service.deleteById(PRESET_ID);

    expect(mockSnapshotRepository.deleteMany).toHaveBeenCalledWith(
      { algorithmPresetId: PRESET_ID },
      expect.objectContaining({ __isTransactionClient: true }),
    );
    expect(mockPresetRepository.deleteById).toHaveBeenCalledWith(
      PRESET_ID,
      expect.objectContaining({ __isTransactionClient: true }),
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
