import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../src/persistence';
import type { SnapshotCreateData } from '../../../src/snapshot/snapshot.repository';
import { SnapshotRepository } from '../../../src/snapshot/snapshot.repository';

const FIXED_NOW = new Date('2026-05-21T00:00:00.000Z');
const PRESET_ID = '01940000-0000-7000-8000-000000000000';
const SNAPSHOT_ID = '01940000-0000-7000-8000-000000000001';

function createRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SNAPSHOT_ID,
    status: 'queued',
    algorithmPresetId: PRESET_ID,
    algorithmPresetFrozen: { key: 'test_key', version: '1.0.0', inputs: [] },
    temporal: null,
    outputs: null,
    error: null,
    startedAt: null,
    completedAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

describe('SnapshotRepository', () => {
  let repository: SnapshotRepository;
  let prismaMock: {
    snapshot: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    prismaMock = {
      snapshot: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
        count: vi.fn(),
      },
    };
    repository = new SnapshotRepository(prismaMock as unknown as PrismaService);
  });

  describe('create', () => {
    it('renames `algorithmPreset` to `algorithmPresetId` and defaults status to queued', async () => {
      const data: SnapshotCreateData = {
        algorithmPreset: PRESET_ID,
        algorithmPresetFrozen: { key: 'k', version: '1', inputs: [] },
      };
      prismaMock.snapshot.create.mockResolvedValue(createRow());

      const result = await repository.create(data);

      expect(prismaMock.snapshot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'queued',
            algorithmPresetId: PRESET_ID,
            algorithmPresetFrozen: data.algorithmPresetFrozen,
          }),
        }),
      );
      expect(result._id).toBe(SNAPSHOT_ID);
      expect(result.algorithmPreset).toBe(PRESET_ID);
    });

    it('passes temporal and outputs JSON through', async () => {
      const data: SnapshotCreateData = {
        algorithmPreset: PRESET_ID,
        algorithmPresetFrozen: { key: 'k', version: '1', inputs: [] },
        temporal: { workflowId: 'wf-1', taskQueue: 'orchestrator' },
        outputs: { csv: 'path' },
      };
      prismaMock.snapshot.create.mockResolvedValue(createRow({ temporal: data.temporal, outputs: data.outputs }));

      const result = await repository.create(data);

      expect(result.temporal).toEqual(data.temporal);
      expect(result.outputs).toEqual(data.outputs);
    });
  });

  describe('findAll', () => {
    it('applies status and algorithmPresetId filters directly', async () => {
      prismaMock.snapshot.count.mockResolvedValue(0);
      prismaMock.snapshot.findMany.mockResolvedValue([]);

      await repository.findAll({ status: 'completed', algorithmPresetId: PRESET_ID }, {});

      expect(prismaMock.snapshot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'completed', algorithmPresetId: PRESET_ID },
        }),
      );
    });

    it('uses Prisma JSON path filters for frozen key/version', async () => {
      prismaMock.snapshot.count.mockResolvedValue(0);
      prismaMock.snapshot.findMany.mockResolvedValue([]);

      await repository.findAll({ frozenKey: 'voting_engagement', frozenVersion: '1.0.0' }, {});

      expect(prismaMock.snapshot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              { algorithmPresetFrozen: { path: ['key'], equals: 'voting_engagement' } },
              { algorithmPresetFrozen: { path: ['version'], equals: '1.0.0' } },
            ],
          },
        }),
      );
    });

    it('returns a PaginateResult with `_id` and `algorithmPreset` mapped from Prisma', async () => {
      prismaMock.snapshot.count.mockResolvedValue(1);
      prismaMock.snapshot.findMany.mockResolvedValue([createRow()]);

      const result = await repository.findAll({}, { page: 1, limit: 10 });

      expect(result.results[0]._id).toBe(SNAPSHOT_ID);
      expect(result.results[0].algorithmPreset).toBe(PRESET_ID);
      expect(result.totalResults).toBe(1);
    });
  });

  describe('findById', () => {
    it('returns null when not found', async () => {
      prismaMock.snapshot.findUnique.mockResolvedValue(null);
      await expect(repository.findById(SNAPSHOT_ID)).resolves.toBeNull();
    });

    it('maps a found row', async () => {
      prismaMock.snapshot.findUnique.mockResolvedValue(createRow());
      const result = await repository.findById(SNAPSHOT_ID);
      expect(result?._id).toBe(SNAPSHOT_ID);
    });
  });

  describe('find', () => {
    it('maps every row from findMany', async () => {
      prismaMock.snapshot.findMany.mockResolvedValue([createRow(), createRow({ id: 'other' })]);

      const result = await repository.find({ algorithmPresetId: PRESET_ID });

      expect(prismaMock.snapshot.findMany).toHaveBeenCalledWith({
        where: { algorithmPresetId: PRESET_ID },
      });
      expect(result).toHaveLength(2);
      expect(result[1]._id).toBe('other');
    });
  });

  describe('deleteById', () => {
    it('delegates to a transactional client when provided', async () => {
      const tx = {
        snapshot: { delete: vi.fn().mockResolvedValue(createRow()) },
      };

      await repository.deleteById(SNAPSHOT_ID, tx as unknown as PrismaService);

      expect(tx.snapshot.delete).toHaveBeenCalledWith({ where: { id: SNAPSHOT_ID } });
      expect(prismaMock.snapshot.delete).not.toHaveBeenCalled();
    });

    it('translates Prisma P2025 (not found) into null', async () => {
      prismaMock.snapshot.delete.mockRejectedValue({ code: 'P2025' });
      await expect(repository.deleteById(SNAPSHOT_ID)).resolves.toBeNull();
    });
  });

  describe('deleteMany', () => {
    it('translates the Prisma `count` into `{ deletedCount }`', async () => {
      prismaMock.snapshot.deleteMany.mockResolvedValue({ count: 3 });

      const result = await repository.deleteMany({ algorithmPresetId: PRESET_ID });

      expect(prismaMock.snapshot.deleteMany).toHaveBeenCalledWith({
        where: { algorithmPresetId: PRESET_ID },
      });
      expect(result).toEqual({ deletedCount: 3 });
    });

    it('honours a transactional client', async () => {
      const tx = {
        snapshot: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      };

      const result = await repository.deleteMany({ algorithmPresetId: PRESET_ID }, tx as unknown as PrismaService);

      expect(tx.snapshot.deleteMany).toHaveBeenCalled();
      expect(result).toEqual({ deletedCount: 2 });
    });
  });
});
