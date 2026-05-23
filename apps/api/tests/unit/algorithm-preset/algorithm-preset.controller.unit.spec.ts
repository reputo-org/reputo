import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AlgorithmPresetController } from '../../../src/algorithm-preset/algorithm-preset.controller';
import type { AlgorithmPresetService } from '../../../src/algorithm-preset/algorithm-preset.service';
import type {
  CreateAlgorithmPresetDto,
  ListAlgorithmPresetsQueryDto,
  UpdateAlgorithmPresetDto,
} from '../../../src/algorithm-preset/dto';

const PRESET_ID = '01940000-0000-7000-8000-000000000000';

describe('AlgorithmPresetController', () => {
  let controller: AlgorithmPresetController;
  let mockService: AlgorithmPresetService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService = {
      create: vi.fn(),
      list: vi.fn(),
      getById: vi.fn(),
      updateById: vi.fn(),
      deleteById: vi.fn(),
    } as unknown as AlgorithmPresetService;

    controller = new AlgorithmPresetController(mockService);
  });

  it('delegates create() to the service', async () => {
    const createDto: CreateAlgorithmPresetDto = {
      key: 'test_key',
      version: '1.0.0',
      inputs: [{ key: 'input1', value: 'value1' }],
    };
    const mockPreset = { _id: PRESET_ID, ...createDto };
    mockService.create = vi.fn().mockResolvedValue(mockPreset);

    const result = await controller.create(createDto);

    expect(mockService.create).toHaveBeenCalledWith(createDto);
    expect(result).toBe(mockPreset);
  });

  it('delegates list() to the service', async () => {
    const queryDto: ListAlgorithmPresetsQueryDto = { key: 'test_key', page: 1, limit: 10 };
    const paginated = { results: [], totalResults: 0, page: 1, limit: 10, totalPages: 0 };
    mockService.list = vi.fn().mockResolvedValue(paginated);

    await expect(controller.list(queryDto)).resolves.toBe(paginated);
    expect(mockService.list).toHaveBeenCalledWith(queryDto);
  });

  it('delegates getById() to the service', async () => {
    const mockPreset = { _id: PRESET_ID, key: 'test_key' };
    mockService.getById = vi.fn().mockResolvedValue(mockPreset);

    await expect(controller.getById(PRESET_ID)).resolves.toBe(mockPreset);
    expect(mockService.getById).toHaveBeenCalledWith(PRESET_ID);
  });

  it('delegates updateById() to the service', async () => {
    const updateDto: UpdateAlgorithmPresetDto = { name: 'Updated' };
    const mockUpdated = { _id: PRESET_ID, ...updateDto };
    mockService.updateById = vi.fn().mockResolvedValue(mockUpdated);

    await expect(controller.updateById(PRESET_ID, updateDto)).resolves.toBe(mockUpdated);
    expect(mockService.updateById).toHaveBeenCalledWith(PRESET_ID, updateDto);
  });

  it('delegates deleteById() to the service', async () => {
    mockService.deleteById = vi.fn().mockResolvedValue(undefined);

    await controller.deleteById(PRESET_ID);

    expect(mockService.deleteById).toHaveBeenCalledWith(PRESET_ID);
  });
});
