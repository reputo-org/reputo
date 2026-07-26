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
import { ApiWorkerStatus } from '../../../src/temporal/api-worker.status';

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
  let workerStatus: ApiWorkerStatus;

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
    // Like the real SDK, run() resolves only once shutdown() is requested.
    worker = {
      run: vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveRun = resolve;
          }),
      ),
      shutdown: vi.fn().mockImplementation(async () => {
        resolveRun?.();
      }),
    };

    mockNativeConnect.mockResolvedValue(connection);
    mockWorkerCreate.mockResolvedValue(worker);
    workerStatus = new ApiWorkerStatus();
  });

  let resolveRun: (() => void) | undefined;

  function createBootstrap() {
    return new ApiWorkerBootstrap(logger as never, configService, snapshotService as never, workerStatus);
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

  it('publishes the worker state for the health endpoint', async () => {
    const bootstrap = createBootstrap();
    await bootstrap.onApplicationBootstrap();

    expect(workerStatus.get()).toBe('up');

    await bootstrap.onApplicationShutdown();
    expect(workerStatus.get()).toBe('down');
  });

  it('schedules a restart when the worker exits unexpectedly', async () => {
    const bootstrap = createBootstrap();
    await bootstrap.onApplicationBootstrap();

    resolveRun?.();
    await vi.waitFor(() => expect(workerStatus.get()).toBe('down'));

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('stopped unexpectedly'));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Retrying'));

    await bootstrap.onApplicationShutdown();
  });

  it('skips worker startup when TEMPORAL_ADDRESS is not configured', async () => {
    configValues['temporal.address'] = undefined;

    const bootstrap = createBootstrap();
    await bootstrap.onApplicationBootstrap();

    expect(mockNativeConnect).not.toHaveBeenCalled();
    expect(mockWorkerCreate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('disabled'));
    expect(workerStatus.get()).toBe('disabled');
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
    worker.shutdown.mockImplementationOnce(async () => {
      resolveRun?.();
      throw new Error('Worker STOPPED');
    });

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
    // The failure schedules a retry with backoff instead of giving up for good.
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Retrying'));
    expect(workerStatus.get()).toBe('down');

    await bootstrap.onApplicationShutdown();
  });
});
