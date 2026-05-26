import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateSnapshotDto, ListSnapshotsQueryDto } from '../../../src/snapshot/dto';
import { SnapshotController } from '../../../src/snapshot/snapshot.controller';
import type { SnapshotService } from '../../../src/snapshot/snapshot.service';
import type { SnapshotEventsService } from '../../../src/snapshot/snapshot-events.service';

const PRESET_ID = '01940000-0000-7000-8000-000000000000';
const SNAPSHOT_ID = '01940000-0000-7000-8000-000000000001';

describe('SnapshotController', () => {
  let controller: SnapshotController;
  let mockService: SnapshotService;
  let mockEventsService: SnapshotEventsService;

  beforeEach(() => {
    vi.clearAllMocks();

    mockService = {
      create: vi.fn(),
      list: vi.fn(),
      getById: vi.fn(),
      deleteById: vi.fn(),
    } as unknown as SnapshotService;

    mockEventsService = {
      subscribe: vi.fn(),
    } as unknown as SnapshotEventsService;

    controller = new SnapshotController(mockService, mockEventsService);
  });

  it('delegates create() to the service', async () => {
    const createDto: CreateSnapshotDto = { algorithmPresetId: PRESET_ID };
    const mockSnapshot = { _id: SNAPSHOT_ID, ...createDto, status: 'queued' };
    mockService.create = vi.fn().mockResolvedValue(mockSnapshot);

    await expect(controller.create(createDto)).resolves.toBe(mockSnapshot);
    expect(mockService.create).toHaveBeenCalledWith(createDto);
  });

  it('delegates list() to the service', async () => {
    const queryDto: ListSnapshotsQueryDto = { status: 'queued', page: 1, limit: 10 };
    const paginated = { results: [], totalResults: 0, page: 1, limit: 10, totalPages: 0 };
    mockService.list = vi.fn().mockResolvedValue(paginated);

    await expect(controller.list(queryDto)).resolves.toBe(paginated);
    expect(mockService.list).toHaveBeenCalledWith(queryDto);
  });

  it('delegates getById() to the service', async () => {
    const mockSnapshot = { _id: SNAPSHOT_ID, algorithmPreset: PRESET_ID, status: 'queued' };
    mockService.getById = vi.fn().mockResolvedValue(mockSnapshot);

    await expect(controller.getById(SNAPSHOT_ID)).resolves.toBe(mockSnapshot);
    expect(mockService.getById).toHaveBeenCalledWith(SNAPSHOT_ID);
  });

  it('delegates deleteById() to the service', async () => {
    mockService.deleteById = vi.fn().mockResolvedValue(undefined);

    await controller.deleteById(SNAPSHOT_ID);

    expect(mockService.deleteById).toHaveBeenCalledWith(SNAPSHOT_ID);
  });
});
