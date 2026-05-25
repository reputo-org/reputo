import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockNativeConnect, mockWorkerCreate } = vi.hoisted(() => ({
  mockNativeConnect: vi.fn(),
  mockWorkerCreate: vi.fn(),
}));

vi.mock('@temporalio/worker', () => ({
  NativeConnection: {
    connect: mockNativeConnect,
  },
  Worker: {
    create: mockWorkerCreate,
  },
}));

import { ApiWorkerBootstrap } from '../../../src/temporal/api-worker.bootstrap';

describe('ApiWorkerBootstrap', () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
    setContext: vi.fn(),
  };

  let configValues: Record<string, string | undefined>;
  let configService: ConfigService;
  let snapshotService: { findByIdOrNull: ReturnType<typeof vi.fn>; applyExternalUpdate: ReturnType<typeof vi.fn> };
  let connection: { close: ReturnType<typeof vi.fn> };
  let worker: { run: ReturnType<typeof vi.fn>; shutdown: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    configValues = {
      'temporal.address': 'localhost:7233',
      'temporal.namespace': 'reputo',
      'temporal.apiSnapshotActivitiesTaskQueue': 'api-snapshot-activities',
    };
    configService = {
      get: vi.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;

    snapshotService = {
      findByIdOrNull: vi.fn(),
      applyExternalUpdate: vi.fn(),
    };

    connection = { close: vi.fn().mockResolvedValue(undefined) };
    worker = {
      run: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };

    mockNativeConnect.mockResolvedValue(connection);
    mockWorkerCreate.mockResolvedValue(worker);
  });

  function createBootstrap() {
    return new ApiWorkerBootstrap(logger as never, configService, snapshotService as never);
  }

  it('starts a worker on bootstrap with the configured task queue', async () => {
    const bootstrap = createBootstrap();
    await bootstrap.onApplicationBootstrap();

    expect(mockNativeConnect).toHaveBeenCalledWith({ address: 'localhost:7233' });
    expect(mockWorkerCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        connection,
        namespace: 'reputo',
        taskQueue: 'api-snapshot-activities',
        activities: expect.any(Object),
      }),
    );
    expect(worker.run).toHaveBeenCalledOnce();
  });

  it('skips worker startup when TEMPORAL_ADDRESS is not configured', async () => {
    configValues['temporal.address'] = undefined;

    const bootstrap = createBootstrap();
    await bootstrap.onApplicationBootstrap();

    expect(mockNativeConnect).not.toHaveBeenCalled();
    expect(mockWorkerCreate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('disabled'));
  });

  it('falls back to the default task queue when env override is unset', async () => {
    configValues['temporal.apiSnapshotActivitiesTaskQueue'] = undefined;

    const bootstrap = createBootstrap();
    await bootstrap.onApplicationBootstrap();

    expect(mockWorkerCreate).toHaveBeenCalledWith(expect.objectContaining({ taskQueue: 'api-snapshot-activities' }));
  });

  it('drains the worker and closes the connection on shutdown', async () => {
    const bootstrap = createBootstrap();
    await bootstrap.onApplicationBootstrap();
    await bootstrap.onApplicationShutdown();

    expect(worker.shutdown).toHaveBeenCalledOnce();
    expect(connection.close).toHaveBeenCalledOnce();
  });

  it('does not propagate "already stopped" errors during shutdown', async () => {
    worker.shutdown.mockRejectedValueOnce(new Error('Worker STOPPED'));

    const bootstrap = createBootstrap();
    await bootstrap.onApplicationBootstrap();
    await expect(bootstrap.onApplicationShutdown()).resolves.toBeUndefined();

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('already stopped'));
  });

  it('logs and swallows connection errors so the HTTP server keeps running', async () => {
    mockNativeConnect.mockRejectedValueOnce(new Error('cannot reach temporal'));

    const bootstrap = createBootstrap();
    await expect(bootstrap.onApplicationBootstrap()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to start'), expect.any(String));
  });
});
