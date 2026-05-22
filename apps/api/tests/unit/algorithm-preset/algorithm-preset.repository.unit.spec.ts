import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlgorithmPresetRepository } from '../../../src/algorithm-preset/algorithm-preset.repository';
import type { CreateAlgorithmPresetDto, UpdateAlgorithmPresetDto } from '../../../src/algorithm-preset/dto';
import type { PrismaService } from '../../../src/persistence';

const FIXED_NOW = new Date('2026-05-21T00:00:00.000Z');
const TEST_UUID = '01940000-0000-7000-8000-000000000000';

type RelationalInput = {
  id?: string;
  key: string;
  value: unknown;
  position: number;
};

function createRow(
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

const includeOrderedInputs = { inputs: { orderBy: { position: 'asc' } } };

describe('AlgorithmPresetRepository', () => {
  let repository: AlgorithmPresetRepository;
  let prismaMock: {
    algorithmPreset: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    prismaMock = {
      algorithmPreset: {
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn(),
        findMany: vi.fn(),
      },
    };
    repository = new AlgorithmPresetRepository(prismaMock as unknown as PrismaService);
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
      prismaMock.algorithmPreset.create.mockResolvedValue(createRow({ ...createDto, inputs: persistedInputs }));

      const result = await repository.create(createDto);

      expect(prismaMock.algorithmPreset.create).toHaveBeenCalledWith({
        data: {
          key: createDto.key,
          version: createDto.version,
          name: createDto.name,
          description: createDto.description,
          inputs: {
            create: [
              { key: 'first', value: 1, position: 0 },
              { key: 'second', value: 'two', position: 1 },
            ],
          },
        },
        include: includeOrderedInputs,
      });
      expect(result._id).toBe(TEST_UUID);
      expect(result.inputs).toEqual([
        { key: 'first', value: 1 },
        { key: 'second', value: 'two' },
      ]);
    });

    it('coerces null name/description from Prisma into undefined', async () => {
      const dto: CreateAlgorithmPresetDto = { key: 'k', version: '1', inputs: [] };
      prismaMock.algorithmPreset.create.mockResolvedValue(createRow({}));

      const result = await repository.create(dto);

      expect(result.name).toBeUndefined();
      expect(result.description).toBeUndefined();
    });
  });

  describe('findAll', () => {
    it('returns the paginated PaginateResult shape and forwards `include` to findMany', async () => {
      const row = createRow({ inputs: [{ id: 'i-1', key: 'k', value: 1, position: 0 }] });
      prismaMock.algorithmPreset.count.mockResolvedValue(1);
      prismaMock.algorithmPreset.findMany.mockResolvedValue([row]);

      const result = await repository.findAll({ key: 'test_key' }, { page: 1, limit: 10 });

      expect(prismaMock.algorithmPreset.count).toHaveBeenCalledWith({ where: { key: 'test_key' } });
      expect(prismaMock.algorithmPreset.findMany).toHaveBeenCalledWith({
        where: { key: 'test_key' },
        orderBy: [{ createdAt: 'desc' }],
        skip: 0,
        take: 10,
        include: includeOrderedInputs,
      });
      expect(result.results[0]._id).toBe(TEST_UUID);
      expect(result.results[0].inputs).toEqual([{ key: 'k', value: 1 }]);
      expect(result.totalResults).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it('parses sortBy into Prisma orderBy', async () => {
      prismaMock.algorithmPreset.count.mockResolvedValue(0);
      prismaMock.algorithmPreset.findMany.mockResolvedValue([]);

      await repository.findAll({}, { sortBy: 'key:asc,version:desc' });

      expect(prismaMock.algorithmPreset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ key: 'asc' }, { version: 'desc' }],
          include: includeOrderedInputs,
        }),
      );
    });
  });

  describe('findById', () => {
    it('passes the ordered include and maps the result', async () => {
      prismaMock.algorithmPreset.findUnique.mockResolvedValue(
        createRow({ inputs: [{ id: 'i-1', key: 'k', value: 1, position: 0 }] }),
      );

      const result = await repository.findById(TEST_UUID);

      expect(prismaMock.algorithmPreset.findUnique).toHaveBeenCalledWith({
        where: { id: TEST_UUID },
        include: includeOrderedInputs,
      });
      expect(result?._id).toBe(TEST_UUID);
      expect(result?.inputs).toEqual([{ key: 'k', value: 1 }]);
    });

    it('returns null when not found', async () => {
      prismaMock.algorithmPreset.findUnique.mockResolvedValue(null);
      await expect(repository.findById(TEST_UUID)).resolves.toBeNull();
    });
  });

  describe('updateById', () => {
    it('only forwards defined name/description fields when inputs are omitted', async () => {
      const updateDto: UpdateAlgorithmPresetDto = { name: 'New Name' };
      prismaMock.algorithmPreset.update.mockResolvedValue(createRow({ name: 'New Name' }));

      const result = await repository.updateById(TEST_UUID, updateDto);

      expect(prismaMock.algorithmPreset.update).toHaveBeenCalledWith({
        where: { id: TEST_UUID },
        data: { name: 'New Name' },
        include: includeOrderedInputs,
      });
      expect(result?.name).toBe('New Name');
    });

    it('replaces child rows with deleteMany + create when inputs are provided, preserving order', async () => {
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
      prismaMock.algorithmPreset.update.mockResolvedValue(createRow({ inputs: persisted }));

      const result = await repository.updateById(TEST_UUID, updateDto);

      const updateCallArgs = prismaMock.algorithmPreset.update.mock.calls[0][0];
      expect(updateCallArgs.where).toEqual({ id: TEST_UUID });
      expect(updateCallArgs.include).toEqual(includeOrderedInputs);
      expect(updateCallArgs.data.inputs).toEqual({
        deleteMany: {},
        create: [
          { key: 'second', value: 'two', position: 0 },
          { key: 'first', value: 1, position: 1 },
          { key: 'third', value: { nested: true }, position: 2 },
        ],
      });
      // Order returned to the caller reflects the persisted positions, which
      // proves the wire shape mirrors the caller's input order.
      expect(result?.inputs).toEqual([
        { key: 'second', value: 'two' },
        { key: 'first', value: 1 },
        { key: 'third', value: { nested: true } },
      ]);
    });

    it('bumps updatedAt explicitly when only inputs change (nested writes do not trigger @updatedAt)', async () => {
      const before = Date.now();
      const updateDto: UpdateAlgorithmPresetDto = { inputs: [{ key: 'only', value: 1 }] };
      prismaMock.algorithmPreset.update.mockResolvedValue(createRow({}));

      await repository.updateById(TEST_UUID, updateDto);

      const updateCallArgs = prismaMock.algorithmPreset.update.mock.calls[0][0];
      expect(updateCallArgs.data.updatedAt).toBeInstanceOf(Date);
      expect((updateCallArgs.data.updatedAt as Date).getTime()).toBeGreaterThanOrEqual(before);
    });

    it('translates Prisma P2025 (not found) into null', async () => {
      prismaMock.algorithmPreset.update.mockRejectedValue({ code: 'P2025' });

      await expect(repository.updateById(TEST_UUID, { name: 'x' })).resolves.toBeNull();
    });
  });

  describe('deleteById', () => {
    it('delegates to the default Prisma client when no transaction is passed', async () => {
      prismaMock.algorithmPreset.delete.mockResolvedValue(createRow({}));

      const result = await repository.deleteById(TEST_UUID);

      expect(prismaMock.algorithmPreset.delete).toHaveBeenCalledWith({
        where: { id: TEST_UUID },
        include: includeOrderedInputs,
      });
      expect(result?._id).toBe(TEST_UUID);
    });

    it('uses the provided transactional client when supplied', async () => {
      const tx = {
        algorithmPreset: { delete: vi.fn().mockResolvedValue(createRow({})) },
      };

      await repository.deleteById(TEST_UUID, tx as unknown as PrismaService);

      expect(tx.algorithmPreset.delete).toHaveBeenCalledWith({
        where: { id: TEST_UUID },
        include: includeOrderedInputs,
      });
      expect(prismaMock.algorithmPreset.delete).not.toHaveBeenCalled();
    });

    it('translates Prisma P2025 (not found) into null', async () => {
      prismaMock.algorithmPreset.delete.mockRejectedValue({ code: 'P2025' });

      await expect(repository.deleteById(TEST_UUID)).resolves.toBeNull();
    });
  });
});
