import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlgorithmPresetRepository } from '../../../src/algorithm-preset/algorithm-preset.repository';
import type { CreateAlgorithmPresetDto, UpdateAlgorithmPresetDto } from '../../../src/algorithm-preset/dto';
import type { PrismaService } from '../../../src/persistence';

const FIXED_NOW = new Date('2026-05-21T00:00:00.000Z');
const TEST_UUID = '01940000-0000-7000-8000-000000000000';

function createRow(
  overrides: Partial<{
    id: string;
    key: string;
    version: string;
    inputs: unknown;
    name: string | null;
    description: string | null;
  }> = {},
) {
  return {
    id: overrides.id ?? TEST_UUID,
    key: overrides.key ?? 'test_key',
    version: overrides.version ?? '1.0.0',
    inputs: overrides.inputs ?? [],
    name: overrides.name ?? null,
    description: overrides.description ?? null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
}

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
    it('passes the DTO through and maps the Prisma row to `_id`', async () => {
      const createDto: CreateAlgorithmPresetDto = {
        key: 'test_key',
        version: '1.0.0',
        inputs: [{ key: 'input1', value: 'value1' }],
        name: 'Test',
        description: 'A description longer than ten chars',
      };
      const row = createRow({ ...createDto });
      prismaMock.algorithmPreset.create.mockResolvedValue(row);

      const result = await repository.create(createDto);

      expect(prismaMock.algorithmPreset.create).toHaveBeenCalledWith({
        data: {
          key: createDto.key,
          version: createDto.version,
          inputs: createDto.inputs,
          name: createDto.name,
          description: createDto.description,
        },
      });
      expect(result._id).toBe(TEST_UUID);
      expect(result.key).toBe('test_key');
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
    it('returns the paginated PaginateResult shape', async () => {
      const row = createRow({ id: TEST_UUID });
      prismaMock.algorithmPreset.count.mockResolvedValue(1);
      prismaMock.algorithmPreset.findMany.mockResolvedValue([row]);

      const result = await repository.findAll({ key: 'test_key' }, { page: 1, limit: 10 });

      expect(prismaMock.algorithmPreset.count).toHaveBeenCalledWith({ where: { key: 'test_key' } });
      expect(prismaMock.algorithmPreset.findMany).toHaveBeenCalledWith({
        where: { key: 'test_key' },
        orderBy: [{ createdAt: 'desc' }],
        skip: 0,
        take: 10,
      });
      expect(result.results[0]._id).toBe(TEST_UUID);
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
        }),
      );
    });
  });

  describe('findById', () => {
    it('returns the row when present', async () => {
      prismaMock.algorithmPreset.findUnique.mockResolvedValue(createRow({}));

      const result = await repository.findById(TEST_UUID);

      expect(prismaMock.algorithmPreset.findUnique).toHaveBeenCalledWith({ where: { id: TEST_UUID } });
      expect(result?._id).toBe(TEST_UUID);
    });

    it('returns null when not found', async () => {
      prismaMock.algorithmPreset.findUnique.mockResolvedValue(null);
      await expect(repository.findById(TEST_UUID)).resolves.toBeNull();
    });
  });

  describe('updateById', () => {
    it('only forwards defined fields to Prisma', async () => {
      const updateDto: UpdateAlgorithmPresetDto = { name: 'New Name' };
      prismaMock.algorithmPreset.update.mockResolvedValue(createRow({ name: 'New Name' }));

      const result = await repository.updateById(TEST_UUID, updateDto);

      expect(prismaMock.algorithmPreset.update).toHaveBeenCalledWith({
        where: { id: TEST_UUID },
        data: { name: 'New Name' },
      });
      expect(result?.name).toBe('New Name');
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

      expect(prismaMock.algorithmPreset.delete).toHaveBeenCalledWith({ where: { id: TEST_UUID } });
      expect(result?._id).toBe(TEST_UUID);
    });

    it('uses the provided transactional client when supplied', async () => {
      const tx = {
        algorithmPreset: { delete: vi.fn().mockResolvedValue(createRow({})) },
      };

      await repository.deleteById(TEST_UUID, tx as unknown as PrismaService);

      expect(tx.algorithmPreset.delete).toHaveBeenCalledWith({ where: { id: TEST_UUID } });
      expect(prismaMock.algorithmPreset.delete).not.toHaveBeenCalled();
    });

    it('translates Prisma P2025 (not found) into null', async () => {
      prismaMock.algorithmPreset.delete.mockRejectedValue({ code: 'P2025' });

      await expect(repository.deleteById(TEST_UUID)).resolves.toBeNull();
    });
  });
});
