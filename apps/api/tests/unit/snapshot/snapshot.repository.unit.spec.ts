import { SnapshotStatus } from '@reputo/contracts';
import type { EntityManager, Repository } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SnapshotEntity, SnapshotOutputEntity } from '../../../src/persistence';
import type { SnapshotCreateData } from '../../../src/snapshot/snapshot.repository';
import { SnapshotRepository } from '../../../src/snapshot/snapshot.repository';

const FIXED_NOW = new Date('2026-05-21T00:00:00.000Z');
const PRESET_ID = '01940000-0000-7000-8000-000000000000';
const SNAPSHOT_ID = '01940000-0000-7000-8000-000000000001';

type RelationalOutput = { id?: string; key: string; value: string };

function createEntity(overrides: Record<string, unknown> = {}) {
  return {
    id: SNAPSHOT_ID,
    status: SnapshotStatus.queued,
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

describe('SnapshotRepository', () => {
  let repository: SnapshotRepository;
  let snapshotRepoMock: Repository<SnapshotEntity> & {
    findOne: ReturnType<typeof vi.fn>;
    findAndCount: ReturnType<typeof vi.fn>;
    find: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  let outputRepoMock: Repository<SnapshotOutputEntity> & {
    save: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  // EntityManager that is handed to the transaction callback. We expose the
  // inner repos directly so individual tests can adjust them.
  let txSnapshotRepo: typeof snapshotRepoMock;
  let txOutputRepo: typeof outputRepoMock;
  let txManager: EntityManager & { query: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    txSnapshotRepo = {
      findOne: vi.fn(),
      findAndCount: vi.fn(),
      find: vi.fn(),
      save: vi.fn(async (entity) => entity),
      delete: vi.fn(),
      create: vi.fn((data) => data),
    } as unknown as typeof snapshotRepoMock;
    txOutputRepo = {
      save: vi.fn(async (rows) => rows),
      delete: vi.fn(),
    } as unknown as typeof outputRepoMock;

    txManager = {
      getRepository: vi.fn((target) => {
        const name = (target as { name?: string }).name ?? '';
        if (name.includes('Output')) return txOutputRepo;
        return txSnapshotRepo;
      }),
      query: vi.fn(async () => undefined),
    } as unknown as EntityManager & { query: ReturnType<typeof vi.fn> };

    outputRepoMock = {
      save: vi.fn(),
      delete: vi.fn(),
    } as unknown as typeof outputRepoMock;

    snapshotRepoMock = {
      findOne: vi.fn(),
      findAndCount: vi.fn(),
      find: vi.fn(),
      save: vi.fn(async (entity) => entity),
      delete: vi.fn(),
      create: vi.fn((data) => data),
      manager: {
        transaction: vi.fn(async (cb: (m: EntityManager) => unknown) => cb(txManager)),
        getRepository: vi.fn((target) => {
          const name = (target as { name?: string }).name ?? '';
          if (name.includes('Output')) return txOutputRepo;
          return txSnapshotRepo;
        }),
      },
    } as unknown as typeof snapshotRepoMock;

    repository = new SnapshotRepository(
      snapshotRepoMock as unknown as Repository<SnapshotEntity>,
      outputRepoMock as unknown as Repository<SnapshotOutputEntity>,
    );
  });

  describe('create', () => {
    it('renames `algorithmPreset` to `algorithmPresetId` and defaults status to queued', async () => {
      const data: SnapshotCreateData = {
        algorithmPreset: PRESET_ID,
        algorithmPresetFrozen: { key: 'k', version: '1', inputs: [] },
      };
      txSnapshotRepo.save.mockResolvedValue(createEntity());
      txSnapshotRepo.findOne.mockResolvedValue(createEntity());

      const result = await repository.create(data);

      expect(txSnapshotRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: SnapshotStatus.queued,
          algorithmPresetId: PRESET_ID,
          algorithmPresetFrozen: data.algorithmPresetFrozen,
        }),
      );
      expect(result._id).toBe(SNAPSHOT_ID);
      expect(result.algorithmPreset).toBe(PRESET_ID);
    });

    it('persists outputs into the relational child table and maps them back to a Record', async () => {
      const data: SnapshotCreateData = {
        algorithmPreset: PRESET_ID,
        algorithmPresetFrozen: { key: 'k', version: '1', inputs: [] },
        temporal: { workflowId: 'wf-1', taskQueue: 'orchestrator' },
        outputs: { csv: 'path' },
      };
      txSnapshotRepo.save.mockResolvedValue(createEntity({ temporal: data.temporal }));
      txSnapshotRepo.findOne.mockResolvedValue(
        createEntity({
          temporal: data.temporal,
          outputs: [{ id: 'o-1', key: 'csv', value: 'path' }],
        }),
      );

      const result = await repository.create(data);

      const savedRows = txOutputRepo.save.mock.calls[0][0] as Array<{ key: string; value: string }>;
      expect(savedRows).toHaveLength(1);
      expect(savedRows[0]).toMatchObject({ key: 'csv', value: 'path' });
      expect(result.temporal).toEqual(data.temporal);
      expect(result.outputs).toEqual({ csv: 'path' });
    });

    it('omits the outputs write when no outputs are provided', async () => {
      const data: SnapshotCreateData = {
        algorithmPreset: PRESET_ID,
        algorithmPresetFrozen: { key: 'k', version: '1', inputs: [] },
      };
      txSnapshotRepo.save.mockResolvedValue(createEntity());
      txSnapshotRepo.findOne.mockResolvedValue(createEntity());

      const result = await repository.create(data);

      expect(txOutputRepo.save).not.toHaveBeenCalled();
      expect(result.outputs).toBeUndefined();
    });
  });

  describe('findAll', () => {
    it('applies status and algorithmPresetId filters directly', async () => {
      snapshotRepoMock.findAndCount.mockResolvedValue([[], 0]);

      await repository.findAll({ status: SnapshotStatus.completed, algorithmPresetId: PRESET_ID }, {});

      expect(snapshotRepoMock.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: SnapshotStatus.completed,
            algorithmPresetId: PRESET_ID,
          }),
          relations: { outputs: true },
        }),
      );
    });

    it('uses JSON path filters for frozen key/version via a Raw clause on `algorithmPresetFrozen`', async () => {
      snapshotRepoMock.findAndCount.mockResolvedValue([[], 0]);

      await repository.findAll({ frozenKey: 'voting_engagement', frozenVersion: '1.0.0' }, {});

      const call = snapshotRepoMock.findAndCount.mock.calls[0][0];
      expect(call).toMatchObject({
        relations: { outputs: true },
      });
      // `algorithmPresetFrozen` is wrapped by TypeORM `Raw(...)` — it should
      // be present on the `where` so the SQL pulls from JSONB.
      const where = call.where as { algorithmPresetFrozen?: unknown };
      expect(where.algorithmPresetFrozen).toBeDefined();
    });

    it('returns a PaginateResult with `_id` and `algorithmPreset` mapped from the entity', async () => {
      snapshotRepoMock.findAndCount.mockResolvedValue([[createEntity()], 1]);

      const result = await repository.findAll({}, { page: 1, limit: 10 });

      expect(result.results[0]._id).toBe(SNAPSHOT_ID);
      expect(result.results[0].algorithmPreset).toBe(PRESET_ID);
      expect(result.totalResults).toBe(1);
    });
  });

  describe('findById', () => {
    it('returns null when not found', async () => {
      snapshotRepoMock.findOne.mockResolvedValue(null);
      await expect(repository.findById(SNAPSHOT_ID)).resolves.toBeNull();
    });

    it('maps a found row and projects outputs into a Record', async () => {
      snapshotRepoMock.findOne.mockResolvedValue(
        createEntity({ outputs: [{ id: 'o-1', key: 'csv', value: 'snapshots/out.csv' }] }),
      );
      const result = await repository.findById(SNAPSHOT_ID);

      expect(snapshotRepoMock.findOne).toHaveBeenCalledWith({
        where: { id: SNAPSHOT_ID },
        relations: { outputs: true },
      });
      expect(result?._id).toBe(SNAPSHOT_ID);
      expect(result?.outputs).toEqual({ csv: 'snapshots/out.csv' });
    });
  });

  describe('find', () => {
    it('maps every row from find and includes outputs', async () => {
      snapshotRepoMock.find.mockResolvedValue([createEntity(), createEntity({ id: 'other' })]);

      const result = await repository.find({ algorithmPresetId: PRESET_ID });

      expect(snapshotRepoMock.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ algorithmPresetId: PRESET_ID }),
          relations: { outputs: true },
        }),
      );
      expect(result).toHaveLength(2);
      expect(result[1]._id).toBe('other');
    });
  });

  describe('deleteById', () => {
    it('uses the provided transactional EntityManager when supplied', async () => {
      const customSnapshotRepo = {
        findOne: vi.fn().mockResolvedValue(createEntity()),
        delete: vi.fn().mockResolvedValue({ affected: 1 }),
      };
      const customManager = {
        getRepository: vi.fn(() => customSnapshotRepo),
      } as unknown as EntityManager;

      await repository.deleteById(SNAPSHOT_ID, customManager);

      expect(customSnapshotRepo.delete).toHaveBeenCalledWith({ id: SNAPSHOT_ID });
      expect(snapshotRepoMock.delete).not.toHaveBeenCalled();
    });

    it('returns null when the row does not exist', async () => {
      txSnapshotRepo.findOne.mockResolvedValue(null);
      await expect(repository.deleteById(SNAPSHOT_ID)).resolves.toBeNull();
    });
  });

  describe('applyExternalUpdate', () => {
    it('runs the update and pg_notify in a single transaction', async () => {
      const initial = createEntity();
      const updated = createEntity({ status: SnapshotStatus.running, startedAt: FIXED_NOW });
      txSnapshotRepo.findOne
        // Inside the transaction: first load, then refresh after save.
        .mockResolvedValueOnce(initial)
        .mockResolvedValueOnce(updated);

      const result = await repository.applyExternalUpdate(SNAPSHOT_ID, {
        status: SnapshotStatus.running,
        startedAt: FIXED_NOW,
      });

      // The transaction wrapped both the entity save and the pg_notify call.
      expect(snapshotRepoMock.manager.transaction).toHaveBeenCalledOnce();
      expect(txSnapshotRepo.save).toHaveBeenCalled();
      expect(txManager.query).toHaveBeenCalledWith('SELECT pg_notify($1, $2)', expect.arrayContaining([SNAPSHOT_ID]));
      expect(result?._id).toBe(SNAPSHOT_ID);
      expect(result?.status).toBe(SnapshotStatus.running);
    });

    it('replaces outputs via `delete + save` inside the same transaction', async () => {
      const initial = createEntity();
      const refreshed = createEntity({
        status: SnapshotStatus.completed,
        completedAt: FIXED_NOW,
        outputs: [{ id: 'o-1', key: 'csv', value: 'snapshots/out.csv' }],
      });
      txSnapshotRepo.findOne.mockResolvedValueOnce(initial).mockResolvedValueOnce(refreshed);

      const result = await repository.applyExternalUpdate(SNAPSHOT_ID, {
        status: SnapshotStatus.completed,
        completedAt: FIXED_NOW,
        outputs: { csv: 'snapshots/out.csv' },
      });

      expect(txOutputRepo.delete).toHaveBeenCalledWith({ snapshotId: SNAPSHOT_ID });
      const savedRows = txOutputRepo.save.mock.calls[0][0] as Array<{ key: string; value: string }>;
      expect(savedRows).toEqual([expect.objectContaining({ key: 'csv', value: 'snapshots/out.csv' })]);
      expect(result?.outputs).toEqual({ csv: 'snapshots/out.csv' });
    });

    it('skips undefined output values when building child rows', async () => {
      const initial = createEntity();
      const refreshed = createEntity({
        outputs: [{ id: 'o-1', key: 'csv', value: 'path' }],
      });
      txSnapshotRepo.findOne.mockResolvedValueOnce(initial).mockResolvedValueOnce(refreshed);

      await repository.applyExternalUpdate(SNAPSHOT_ID, { outputs: { csv: 'path', skipped: undefined } });

      const savedRows = txOutputRepo.save.mock.calls[0][0] as Array<{ key: string; value: string }>;
      expect(savedRows).toEqual([expect.objectContaining({ key: 'csv', value: 'path' })]);
    });

    it('returns null when the row is not found inside the transaction', async () => {
      txSnapshotRepo.findOne.mockResolvedValueOnce(null);

      await expect(
        repository.applyExternalUpdate(SNAPSHOT_ID, { status: SnapshotStatus.completed }),
      ).resolves.toBeNull();
    });

    it('rethrows unexpected transaction errors', async () => {
      snapshotRepoMock.manager.transaction = vi.fn(async () => {
        throw new Error('boom');
      });

      await expect(repository.applyExternalUpdate(SNAPSHOT_ID, { status: SnapshotStatus.completed })).rejects.toThrow(
        'boom',
      );
    });
  });

  describe('deleteMany', () => {
    it('translates the TypeORM affected count into `{ deletedCount }`', async () => {
      // Default branch resolves the inner repo via `this.snapshots.manager`,
      // which our mock routes to `txSnapshotRepo`.
      txSnapshotRepo.delete.mockResolvedValue({ affected: 3 });

      const result = await repository.deleteMany({ algorithmPresetId: PRESET_ID });

      expect(txSnapshotRepo.delete).toHaveBeenCalledWith(expect.objectContaining({ algorithmPresetId: PRESET_ID }));
      expect(result).toEqual({ deletedCount: 3 });
    });

    it('honours a transactional EntityManager', async () => {
      const customSnapshotRepo = {
        delete: vi.fn().mockResolvedValue({ affected: 2 }),
      };
      const customManager = {
        getRepository: vi.fn(() => customSnapshotRepo),
      } as unknown as EntityManager;

      const result = await repository.deleteMany({ algorithmPresetId: PRESET_ID }, customManager);

      expect(customSnapshotRepo.delete).toHaveBeenCalled();
      expect(result).toEqual({ deletedCount: 2 });
    });
  });
});
