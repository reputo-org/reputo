import type { EntityManager, Repository } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlgorithmPresetRepository } from '../../../src/algorithm-preset/algorithm-preset.repository';
import type { CreateAlgorithmPresetDto, UpdateAlgorithmPresetDto } from '../../../src/algorithm-preset/dto';
import type { AlgorithmPresetEntity, AlgorithmPresetInputEntity } from '../../../src/persistence';

const FIXED_NOW = new Date('2026-05-21T00:00:00.000Z');
const TEST_UUID = '01940000-0000-7000-8000-000000000000';

type RelationalInput = {
  id?: string;
  key: string;
  value: unknown;
  position: number;
};

function createEntity(
  overrides: Partial<{
    id: string;
    key: string;
    version: string;
    inputs: RelationalInput[];
    name: string | null;
    description: string | null;
  }> = {},
) {
  return {
    id: overrides.id ?? TEST_UUID,
    key: overrides.key ?? 'test_key',
    version: overrides.version ?? '1.0.0',
    name: overrides.name ?? null,
    description: overrides.description ?? null,
    inputs: overrides.inputs ?? [],
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
}

describe('AlgorithmPresetRepository', () => {
  let repository: AlgorithmPresetRepository;
  let presetRepoMock: Repository<AlgorithmPresetEntity> & {
    findOne: ReturnType<typeof vi.fn>;
    findAndCount: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  let inputRepoMock: Repository<AlgorithmPresetInputEntity> & {
    save: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let txPresetRepo: typeof presetRepoMock;
  let txInputRepo: typeof inputRepoMock;
  let txManager: EntityManager;

  beforeEach(() => {
    txPresetRepo = {
      findOne: vi.fn(),
      save: vi.fn(async (entity) => entity),
      delete: vi.fn(),
      create: vi.fn((data) => data),
      findAndCount: vi.fn(),
    } as unknown as typeof presetRepoMock;
    txInputRepo = {
      save: vi.fn(async (rows) => rows),
      delete: vi.fn(),
    } as unknown as typeof inputRepoMock;

    txManager = {
      getRepository: vi.fn((target) => {
        const name = (target as { name?: string }).name ?? '';
        if (name.includes('Input')) return txInputRepo;
        return txPresetRepo;
      }),
    } as unknown as EntityManager;

    inputRepoMock = {
      save: vi.fn(),
      delete: vi.fn(),
    } as unknown as typeof inputRepoMock;

    presetRepoMock = {
      findOne: vi.fn(),
      findAndCount: vi.fn(),
      save: vi.fn(async (entity) => entity),
      delete: vi.fn(),
      create: vi.fn((data) => data),
      manager: {
        transaction: vi.fn(async (cb: (m: EntityManager) => unknown) => cb(txManager)),
        getRepository: vi.fn((target) => {
          const name = (target as { name?: string }).name ?? '';
          if (name.includes('Input')) return txInputRepo;
          return txPresetRepo;
        }),
      },
    } as unknown as typeof presetRepoMock;

    repository = new AlgorithmPresetRepository(
      presetRepoMock as unknown as Repository<AlgorithmPresetEntity>,
      inputRepoMock as unknown as Repository<AlgorithmPresetInputEntity>,
    );
  });

  describe('create', () => {
    it('issues a nested create with positional indexes preserving caller order', async () => {
      const createDto: CreateAlgorithmPresetDto = {
        key: 'test_key',
        version: '1.0.0',
        inputs: [
          { key: 'first', value: 1 },
          { key: 'second', value: 'two' },
        ],
        name: 'Test',
        description: 'A description longer than ten chars',
      };
      const persistedInputs: RelationalInput[] = [
        { id: 'i-1', key: 'first', value: 1, position: 0 },
        { id: 'i-2', key: 'second', value: 'two', position: 1 },
      ];
      txPresetRepo.save.mockResolvedValue(createEntity({ ...createDto, inputs: persistedInputs }));
      txPresetRepo.findOne.mockResolvedValue(createEntity({ ...createDto, inputs: persistedInputs }));

      const result = await repository.create(createDto);

      expect(txPresetRepo.create).toHaveBeenCalledWith({
        key: createDto.key,
        version: createDto.version,
        name: createDto.name,
        description: createDto.description,
      });
      const savedInputs = txInputRepo.save.mock.calls[0][0] as Array<{
        key: string;
        position: number;
        value: unknown;
      }>;
      expect(savedInputs).toHaveLength(2);
      expect(savedInputs[0]).toMatchObject({ key: 'first', position: 0, value: 1 });
      expect(savedInputs[1]).toMatchObject({ key: 'second', position: 1, value: 'two' });

      expect(result._id).toBe(TEST_UUID);
      expect(result.inputs).toEqual([
        { key: 'first', value: 1 },
        { key: 'second', value: 'two' },
      ]);
    });

    it('coerces null name/description from the entity into undefined', async () => {
      const dto: CreateAlgorithmPresetDto = { key: 'k', version: '1', inputs: [] };
      txPresetRepo.save.mockResolvedValue(createEntity({}));
      txPresetRepo.findOne.mockResolvedValue(createEntity({}));

      const result = await repository.create(dto);

      expect(result.name).toBeUndefined();
      expect(result.description).toBeUndefined();
    });
  });

  describe('findAll', () => {
    it('returns the paginated PaginateResult shape and loads the inputs relation', async () => {
      const row = createEntity({ inputs: [{ id: 'i-1', key: 'k', value: 1, position: 0 }] });
      presetRepoMock.findAndCount.mockResolvedValue([[row], 1]);

      const result = await repository.findAll({ key: 'test_key' }, { page: 1, limit: 10 });

      expect(presetRepoMock.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: 'test_key' },
          order: { createdAt: 'DESC' },
          skip: 0,
          take: 10,
          relations: { inputs: true },
        }),
      );
      expect(result.results[0]._id).toBe(TEST_UUID);
      expect(result.results[0].inputs).toEqual([{ key: 'k', value: 1 }]);
      expect(result.totalResults).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it('parses sortBy into TypeORM order', async () => {
      presetRepoMock.findAndCount.mockResolvedValue([[], 0]);

      await repository.findAll({}, { sortBy: 'key:asc,version:desc' });

      expect(presetRepoMock.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { key: 'ASC', version: 'DESC' },
          relations: { inputs: true },
        }),
      );
    });
  });

  describe('findById', () => {
    it('uses findOne with the inputs relation and maps the result', async () => {
      presetRepoMock.findOne.mockResolvedValue(
        createEntity({ inputs: [{ id: 'i-1', key: 'k', value: 1, position: 0 }] }),
      );

      const result = await repository.findById(TEST_UUID);

      expect(presetRepoMock.findOne).toHaveBeenCalledWith({
        where: { id: TEST_UUID },
        relations: { inputs: true },
      });
      expect(result?._id).toBe(TEST_UUID);
      expect(result?.inputs).toEqual([{ key: 'k', value: 1 }]);
    });

    it('returns null when not found', async () => {
      presetRepoMock.findOne.mockResolvedValue(null);
      await expect(repository.findById(TEST_UUID)).resolves.toBeNull();
    });
  });

  describe('updateById', () => {
    it('only forwards defined name/description fields when inputs are omitted', async () => {
      const updateDto: UpdateAlgorithmPresetDto = { name: 'New Name' };
      const existing = createEntity({});
      txPresetRepo.findOne.mockResolvedValueOnce(existing).mockResolvedValueOnce(createEntity({ name: 'New Name' }));

      const result = await repository.updateById(TEST_UUID, updateDto);

      expect(txPresetRepo.findOne).toHaveBeenCalledWith({ where: { id: TEST_UUID } });
      expect(txPresetRepo.save).toHaveBeenCalled();
      expect(txInputRepo.delete).not.toHaveBeenCalled();
      expect(txInputRepo.save).not.toHaveBeenCalled();
      expect(result?.name).toBe('New Name');
    });

    it('replaces child rows with delete + save when inputs are provided, preserving order', async () => {
      const updateDto: UpdateAlgorithmPresetDto = {
        inputs: [
          { key: 'second', value: 'two' },
          { key: 'first', value: 1 },
          { key: 'third', value: { nested: true } },
        ],
      };
      const persisted: RelationalInput[] = [
        { id: 'i-1', key: 'second', value: 'two', position: 0 },
        { id: 'i-2', key: 'first', value: 1, position: 1 },
        { id: 'i-3', key: 'third', value: { nested: true }, position: 2 },
      ];
      txPresetRepo.findOne
        .mockResolvedValueOnce(createEntity({}))
        .mockResolvedValueOnce(createEntity({ inputs: persisted }));

      const result = await repository.updateById(TEST_UUID, updateDto);

      expect(txInputRepo.delete).toHaveBeenCalledWith({ algorithmPresetId: TEST_UUID });
      const savedInputs = txInputRepo.save.mock.calls[0][0] as Array<{
        key: string;
        position: number;
        value: unknown;
      }>;
      expect(savedInputs).toEqual([
        expect.objectContaining({ key: 'second', position: 0, value: 'two' }),
        expect.objectContaining({ key: 'first', position: 1, value: 1 }),
        expect.objectContaining({ key: 'third', position: 2, value: { nested: true } }),
      ]);
      expect(result?.inputs).toEqual([
        { key: 'second', value: 'two' },
        { key: 'first', value: 1 },
        { key: 'third', value: { nested: true } },
      ]);
    });

    it('bumps updatedAt explicitly when only inputs change (nested writes do not trigger @UpdateDateColumn)', async () => {
      const before = Date.now();
      const updateDto: UpdateAlgorithmPresetDto = { inputs: [{ key: 'only', value: 1 }] };
      const existing = createEntity({});
      txPresetRepo.findOne.mockResolvedValueOnce(existing).mockResolvedValueOnce(createEntity({}));

      await repository.updateById(TEST_UUID, updateDto);

      const savedEntity = txPresetRepo.save.mock.calls[0][0] as { updatedAt: Date };
      expect(savedEntity.updatedAt).toBeInstanceOf(Date);
      expect(savedEntity.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('returns null when the preset does not exist (findOne miss)', async () => {
      txPresetRepo.findOne.mockResolvedValue(null);

      await expect(repository.updateById(TEST_UUID, { name: 'x' })).resolves.toBeNull();
    });
  });

  describe('deleteById', () => {
    it('uses the default EntityManager when no transactional manager is passed', async () => {
      txPresetRepo.findOne.mockResolvedValue(createEntity({}));
      txPresetRepo.delete.mockResolvedValue({ affected: 1 });

      const result = await repository.deleteById(TEST_UUID);

      expect(txPresetRepo.findOne).toHaveBeenCalledWith({
        where: { id: TEST_UUID },
        relations: { inputs: true },
      });
      expect(txPresetRepo.delete).toHaveBeenCalledWith({ id: TEST_UUID });
      expect(result?._id).toBe(TEST_UUID);
    });

    it('uses the provided transactional EntityManager when supplied', async () => {
      const customPresetRepo = {
        findOne: vi.fn().mockResolvedValue(createEntity({})),
        delete: vi.fn().mockResolvedValue({ affected: 1 }),
      };
      const customManager = {
        getRepository: vi.fn(() => customPresetRepo),
      } as unknown as EntityManager;

      await repository.deleteById(TEST_UUID, customManager);

      expect(customPresetRepo.delete).toHaveBeenCalledWith({ id: TEST_UUID });
      expect(presetRepoMock.delete).not.toHaveBeenCalled();
    });

    it('returns null when the row does not exist', async () => {
      txPresetRepo.findOne.mockResolvedValue(null);

      await expect(repository.deleteById(TEST_UUID)).resolves.toBeNull();
    });
  });
});
