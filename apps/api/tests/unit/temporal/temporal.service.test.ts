import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLazy, mockClientConstructor } = vi.hoisted(() => ({
  mockLazy: vi.fn(),
  mockClientConstructor: vi.fn(),
}));
let mockClientInstance: {
  workflow: {
    start: ReturnType<typeof vi.fn>;
    getHandle: ReturnType<typeof vi.fn>;
  };
};

vi.mock('@temporalio/client', () => ({
  Connection: {
    lazy: mockLazy,
  },
  Client: vi.fn().mockImplementation((options) => {
    mockClientConstructor(options);
    return mockClientInstance;
  }),
}));

import { TemporalService } from '../../../src/temporal/temporal.service';

describe('TemporalService', () => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    log: vi.fn(),
    setContext: vi.fn(),
  };

  let configService: ConfigService;
  let service: TemporalService;
  let mockConnection: {
    close: ReturnType<typeof vi.fn>;
    healthService: { check: ReturnType<typeof vi.fn> };
  };
  let healthCheckIntervalMs: number;

  beforeEach(() => {
    vi.clearAllMocks();

    mockConnection = {
      close: vi.fn().mockResolvedValue(undefined),
      healthService: { check: vi.fn().mockResolvedValue({}) },
    };
    mockClientInstance = {
      workflow: {
        start: vi.fn().mockResolvedValue(undefined),
        getHandle: vi.fn(),
      },
    };

    mockLazy.mockReturnValue(mockConnection);
    healthCheckIntervalMs = 0;

    configService = {
      get: vi.fn((key: string) => {
        const values: Record<string, string | number> = {
          'temporal.address': 'localhost:7233',
          'temporal.namespace': 'reputo',
          'temporal.orchestratorTaskQueue': 'orchestrator-q',
          'temporal.healthCheckIntervalMs': healthCheckIntervalMs,
        };

        return values[key];
      }),
    } as unknown as ConfigService;

    service = new TemporalService(mockLogger as never, configService);
  });

  it('creates a lazy connection and client on module init', () => {
    service.onModuleInit();

    expect(mockLazy).toHaveBeenCalledWith({ address: 'localhost:7233' });
    expect(mockClientConstructor).toHaveBeenCalledWith({
      connection: mockConnection,
      namespace: 'reputo',
    });
  });

  it('reports availability from the health probe and recovers on success', async () => {
    healthCheckIntervalMs = 30_000;
    mockConnection.healthService.check.mockRejectedValueOnce(new Error('unreachable'));

    service.onModuleInit();
    await vi.waitFor(() => expect(mockConnection.healthService.check).toHaveBeenCalled());
    expect(service.getAvailability()).toBe('down');

    // The next probe succeeds; drive it via the private refresh to avoid timers.
    await (service as unknown as { refreshAvailability(): Promise<void> }).refreshAvailability();
    expect(service.getAvailability()).toBe('up');

    await service.onModuleDestroy();
  });

  it('starts the orchestrator workflow with the configured task queue and the 30-hour run timeout', async () => {
    service.onModuleInit();

    const result = await service.startRunSnapshotWorkflow('snapshot-123');

    // The literal value matters: the run timeout is only a backstop and must
    // outlast the workflow's own 24-hour encryption-readiness deadline plus
    // pre/post work, so asserting the constant against itself would prove
    // nothing.
    expect(mockClientInstance.workflow.start).toHaveBeenCalledWith('OrchestratorWorkflow', {
      taskQueue: 'orchestrator-q',
      workflowId: 'snapshot-snapshot-123',
      workflowRunTimeout: '30 hours',
      args: [
        {
          snapshotId: 'snapshot-123',
        },
      ],
    });
    expect(result).toEqual({ workflowId: 'snapshot-snapshot-123' });
  });

  it('treats an already-started workflow as a successful start', async () => {
    service.onModuleInit();
    mockClientInstance.workflow.start.mockRejectedValue(
      Object.assign(new Error('already started'), { name: 'WorkflowExecutionAlreadyStartedError' }),
    );

    await expect(service.startRunSnapshotWorkflow('snapshot-123')).resolves.toEqual({
      workflowId: 'snapshot-snapshot-123',
    });
  });

  it('throws when starting a workflow without an available client', async () => {
    await expect(service.startRunSnapshotWorkflow('snapshot-123')).rejects.toThrow(
      'Temporal client is not available. Check TEMPORAL_ADDRESS configuration.',
    );
  });

  it('describes a workflow execution and maps missing workflows to not_found', async () => {
    service.onModuleInit();
    const describe = vi.fn().mockResolvedValue({ status: { name: 'TIMED_OUT' } });
    mockClientInstance.workflow.getHandle.mockReturnValue({ describe });

    await expect(service.describeSnapshotWorkflow('wf-1')).resolves.toEqual({
      outcome: 'described',
      status: 'TIMED_OUT',
    });

    describe.mockRejectedValue(Object.assign(new Error('missing'), { name: 'WorkflowNotFoundError' }));
    await expect(service.describeSnapshotWorkflow('wf-1')).resolves.toEqual({ outcome: 'not_found' });

    describe.mockRejectedValue(new Error('transport down'));
    await expect(service.describeSnapshotWorkflow('wf-1')).rejects.toThrow('transport down');
  });

  it('treats missing workflows as already completed during cancellation', async () => {
    const handle = {
      cancel: vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { name: 'WorkflowNotFoundError' })),
    };
    mockClientInstance.workflow.getHandle.mockReturnValue(handle);
    service.onModuleInit();

    await expect(service.cancelWorkflow('snapshot-123')).resolves.toBeUndefined();
    expect(mockLogger.warn).toHaveBeenCalledWith('Workflow snapshot-123 not found, may have already completed');
  });

  it('waits for terminated workflows to reach a terminal state when requested', async () => {
    const handle = {
      terminate: vi.fn().mockResolvedValue(undefined),
      result: vi.fn().mockRejectedValue(
        Object.assign(new Error('workflow terminated'), {
          name: 'WorkflowExecutionTerminatedError',
        }),
      ),
    };
    mockClientInstance.workflow.getHandle.mockReturnValue(handle);
    service.onModuleInit();

    await expect(service.terminateWorkflow('snapshot-123', true)).resolves.toBeUndefined();

    expect(handle.terminate).toHaveBeenCalledWith('Workflow terminated due to algorithm preset or snapshot deletion');
    expect(handle.result).toHaveBeenCalledOnce();
    expect(mockLogger.info).toHaveBeenCalledWith('Workflow snapshot-123 confirmed terminated');
  });

  it('terminates queued and running snapshots in bulk, deriving legacy workflow ids', async () => {
    const terminateSnapshotWorkflow = vi.spyOn(service, 'terminateSnapshotWorkflow').mockResolvedValue(undefined);

    await service.terminateSnapshotWorkflows(
      [
        {
          status: 'running',
          temporal: { workflowId: 'wf-1' },
        },
        {
          status: 'queued',
          temporal: { workflowId: 'wf-2' },
        },
        {
          _id: 'snap-3',
          status: 'queued',
          temporal: {},
        },
        {
          status: 'completed',
          temporal: { workflowId: 'wf-4' },
        },
        {
          status: 'running',
          temporal: {},
        },
      ] as never,
      true,
    );

    expect(terminateSnapshotWorkflow).toHaveBeenCalledTimes(3);
    expect(terminateSnapshotWorkflow).toHaveBeenCalledWith('wf-1', true);
    expect(terminateSnapshotWorkflow).toHaveBeenCalledWith('wf-2', true);
    expect(terminateSnapshotWorkflow).toHaveBeenCalledWith('snapshot-snap-3', true);
  });

  it('closes the Temporal connection during module destroy', async () => {
    service.onModuleInit();

    await service.onModuleDestroy();

    expect(mockConnection.close).toHaveBeenCalledOnce();
  });
});
