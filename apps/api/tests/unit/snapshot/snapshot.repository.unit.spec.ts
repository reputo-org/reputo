import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../src/persistence';
import type { SnapshotCreateData } from '../../../src/snapshot/snapshot.repository';
import { SnapshotRepository } from '../../../src/snapshot/snapshot.repository';

const FIXED_NOW = new Date('2026-05-21T00:00:00.000Z');
const PRESET_ID = '01940000-0000-7000-8000-000000000000';
const SNAPSHOT_ID = '01940000-0000-7000-8000-000000000001';

type RelationalOutput = {
  id?: string;
  key: string;
  value: string;
};

function createRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SNAPSHOT_ID,
    status: 'queued',
    algorithmPresetId: PRESET_ID,
    algorithmPresetFrozen: { key: 'test_key', version: '1.0.0', inputs: [] },
    temporal: null,
    error: null,
    startedAt: null,
    completedAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    outputs: [] as RelationalOutput[],
    ...overrides,
  };
}

const includeOutputs = { outputs: true };

describe('SnapshotRepository', () => {
  let repository: SnapshotRepository;
  let prismaMock: {
    snapshot: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
    $executeRaw: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    prismaMock = {
      snapshot: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        deleteMany: vi.fn(),
        count: vi.fn(),
      },
      $transaction: vi.fn(),
      $executeRaw: vi.fn(),
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

      expect(prismaMock.snapshot.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'queued',
          algorithmPresetId: PRESET_ID,
          algorithmPresetFrozen: data.algorithmPresetFrozen,
        }),
        include: includeOutputs,
      });
      expect(result._id).toBe(SNAPSHOT_ID);
      expect(result.algorithmPreset).toBe(PRESET_ID);
    });

    it('persists outputs via a nested create and maps them back to a Record', async () => {
      const data: SnapshotCreateData = {
        algorithmPreset: PRESET_ID,
        algorithmPresetFrozen: { key: 'k', version: '1', inputs: [] },
        temporal: { workflowId: 'wf-1', taskQueue: 'orchestrator' },
        outputs: { csv: 'path' },
      };
      prismaMock.snapshot.create.mockResolvedValue(
        createRow({
          temporal: data.temporal,
          outputs: [{ id: 'o-1', key: 'csv', value: 'path' }],
        }),
      );

      const result = await repository.create(data);

      const createArgs = prismaMock.snapshot.create.mock.calls[0][0];
      expect(createArgs.data.outputs).toEqual({ create: [{ key: 'csv', value: 'path' }] });
      expect(result.temporal).toEqual(data.temporal);
      expect(result.outputs).toEqual({ csv: 'path' });
    });

    it('omits the outputs nested write when no outputs are provided', async () => {
      const data: SnapshotCreateData = {
        algorithmPreset: PRESET_ID,
        algorithmPresetFrozen: { key: 'k', version: '1', inputs: [] },
      };
      prismaMock.snapshot.create.mockResolvedValue(createRow());

      const result = await repository.create(data);

      const createArgs = prismaMock.snapshot.create.mock.calls[0][0];
      expect(createArgs.data.outputs).toBeUndefined();
      expect(result.outputs).toBeUndefined();
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
          include: includeOutputs,
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
          include: includeOutputs,
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

    it('maps a found row and projects outputs into a Record', async () => {
      prismaMock.snapshot.findUnique.mockResolvedValue(
        createRow({ outputs: [{ id: 'o-1', key: 'csv', value: 'snapshots/out.csv' }] }),
      );
      const result = await repository.findById(SNAPSHOT_ID);

      expect(prismaMock.snapshot.findUnique).toHaveBeenCalledWith({
        where: { id: SNAPSHOT_ID },
        include: includeOutputs,
      });
      expect(result?._id).toBe(SNAPSHOT_ID);
      expect(result?.outputs).toEqual({ csv: 'snapshots/out.csv' });
    });
  });

  describe('find', () => {
    it('maps every row from findMany and includes outputs', async () => {
      prismaMock.snapshot.findMany.mockResolvedValue([createRow(), createRow({ id: 'other' })]);

      const result = await repository.find({ algorithmPresetId: PRESET_ID });

      expect(prismaMock.snapshot.findMany).toHaveBeenCalledWith({
        where: { algorithmPresetId: PRESET_ID },
        include: includeOutputs,
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

      expect(tx.snapshot.delete).toHaveBeenCalledWith({
        where: { id: SNAPSHOT_ID },
        include: includeOutputs,
      });
      expect(prismaMock.snapshot.delete).not.toHaveBeenCalled();
    });

    it('translates Prisma P2025 (not found) into null', async () => {
      prismaMock.snapshot.delete.mockRejectedValue({ code: 'P2025' });
      await expect(repository.deleteById(SNAPSHOT_ID)).resolves.toBeNull();
    });
  });

  describe('applyExternalUpdate', () => {
    it('runs the update and pg_notify in a single $transaction batch', async () => {
      const updatedRow = createRow({ status: 'running', startedAt: FIXED_NOW });
      prismaMock.snapshot.update.mockReturnValue('update-call');
      prismaMock.$executeRaw.mockReturnValue('notify-call');
      prismaMock.$transaction.mockResolvedValue([updatedRow, 1]);

      const result = await repository.applyExternalUpdate(SNAPSHOT_ID, { status: 'running', startedAt: FIXED_NOW });

      expect(prismaMock.snapshot.update).toHaveBeenCalledWith({
        where: { id: SNAPSHOT_ID },
        data: { status: 'running', startedAt: FIXED_NOW },
        include: includeOutputs,
      });
      expect(prismaMock.$transaction).toHaveBeenCalledWith(['update-call', 'notify-call']);
      expect(result?._id).toBe(SNAPSHOT_ID);
      expect(result?.status).toBe('running');
    });

    it('replaces outputs via `deleteMany + create` inside the same transaction', async () => {
      const updatedRow = createRow({
        status: 'completed',
        completedAt: FIXED_NOW,
        outputs: [{ id: 'o-1', key: 'csv', value: 'snapshots/out.csv' }],
      });
      prismaMock.snapshot.update.mockReturnValue('update-call');
      prismaMock.$executeRaw.mockReturnValue('notify-call');
      prismaMock.$transaction.mockResolvedValue([updatedRow, 1]);

      const result = await repository.applyExternalUpdate(SNAPSHOT_ID, {
        status: 'completed',
        completedAt: FIXED_NOW,
        outputs: { csv: 'snapshots/out.csv' },
      });

      const updateArgs = prismaMock.snapshot.update.mock.calls[0][0];
      expect(updateArgs.data.outputs).toEqual({
        deleteMany: {},
        create: [{ key: 'csv', value: 'snapshots/out.csv' }],
      });
      expect(result?.outputs).toEqual({ csv: 'snapshots/out.csv' });
    });

    it('skips undefined output values when building child rows', async () => {
      const updatedRow = createRow({ outputs: [{ id: 'o-1', key: 'csv', value: 'path' }] });
      prismaMock.snapshot.update.mockReturnValue('update-call');
      prismaMock.$executeRaw.mockReturnValue('notify-call');
      prismaMock.$transaction.mockResolvedValue([updatedRow, 1]);

      await repository.applyExternalUpdate(SNAPSHOT_ID, { outputs: { csv: 'path', skipped: undefined } });

      const updateArgs = prismaMock.snapshot.update.mock.calls[0][0];
      expect(updateArgs.data.outputs).toEqual({
        deleteMany: {},
        create: [{ key: 'csv', value: 'path' }],
      });
    });

    it('returns null when Prisma reports record-not-found (P2025)', async () => {
      prismaMock.snapshot.update.mockReturnValue('update-call');
      prismaMock.$executeRaw.mockReturnValue('notify-call');
      prismaMock.$transaction.mockRejectedValue({ code: 'P2025' });

      await expect(repository.applyExternalUpdate(SNAPSHOT_ID, { status: 'completed' })).resolves.toBeNull();
    });

    it('rethrows non-P2025 errors', async () => {
      prismaMock.snapshot.update.mockReturnValue('update-call');
      prismaMock.$executeRaw.mockReturnValue('notify-call');
      prismaMock.$transaction.mockRejectedValue(new Error('boom'));

      await expect(repository.applyExternalUpdate(SNAPSHOT_ID, { status: 'completed' })).rejects.toThrow('boom');
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
