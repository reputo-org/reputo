import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKFLOW_RUN_TIMEOUT } from '../../../src/shared/constants/temporal.constants';

const { mockConnect, mockClientConstructor } = vi.hoisted(() => ({
  mockConnect: vi.fn(),
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
    connect: mockConnect,
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
  let mockConnection: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    mockConnection = {
      close: vi.fn().mockResolvedValue(undefined),
    };
    mockClientInstance = {
      workflow: {
        start: vi.fn().mockResolvedValue(undefined),
        getHandle: vi.fn(),
      },
    };

    mockConnect.mockResolvedValue(mockConnection);

    configService = {
      get: vi.fn((key: string) => {
        const values: Record<string, string> = {
          'temporal.address': 'localhost:7233',
          'temporal.namespace': 'reputo',
          'temporal.orchestratorTaskQueue': 'orchestrator-q',
        };

        return values[key];
      }),
    } as unknown as ConfigService;

    service = new TemporalService(mockLogger as never, configService);
  });

  it('connects to Temporal on module init', async () => {
    await service.onModuleInit();

    expect(mockConnect).toHaveBeenCalledWith({ address: 'localhost:7233' });
    expect(mockClientConstructor).toHaveBeenCalledWith({
      connection: mockConnection,
      namespace: 'reputo',
    });
  });

  it('logs init failures without throwing', async () => {
    mockConnect.mockRejectedValueOnce(new Error('cannot connect'));

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalledWith('Failed to connect to Temporal: cannot connect', expect.any(String));
  });

  it('starts the orchestrator workflow with the configured task queue', async () => {
    (service as { client: typeof mockClientInstance }).client = mockClientInstance;

    await service.startRunSnapshotWorkflow('snapshot-123');

    expect(mockClientInstance.workflow.start).toHaveBeenCalledWith('OrchestratorWorkflow', {
      taskQueue: 'orchestrator-q',
      workflowId: 'snapshot-snapshot-123',
      workflowRunTimeout: WORKFLOW_RUN_TIMEOUT,
      args: [
        {
          snapshotId: 'snapshot-123',
        },
      ],
    });
  });

  it('throws when starting a workflow without an available client', async () => {
    await expect(service.startRunSnapshotWorkflow('snapshot-123')).rejects.toThrow(
      'Temporal client is not available. Check TEMPORAL_ADDRESS configuration.',
    );
  });

  it('treats missing workflows as already completed during cancellation', async () => {
    const handle = {
      cancel: vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { name: 'WorkflowNotFoundError' })),
    };
    mockClientInstance.workflow.getHandle.mockReturnValue(handle);
    (service as { client: typeof mockClientInstance }).client = mockClientInstance;

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
    (service as { client: typeof mockClientInstance }).client = mockClientInstance;

    await expect(service.terminateWorkflow('snapshot-123', true)).resolves.toBeUndefined();

    expect(handle.terminate).toHaveBeenCalledWith('Workflow terminated due to algorithm preset or snapshot deletion');
    expect(handle.result).toHaveBeenCalledOnce();
    expect(mockLogger.info).toHaveBeenCalledWith('Workflow snapshot-123 confirmed terminated');
  });

  it('filters running snapshots before terminating workflows in bulk', async () => {
    const terminateSnapshotWorkflow = vi.spyOn(service, 'terminateSnapshotWorkflow').mockResolvedValue(undefined);

    await service.terminateSnapshotWorkflows(
      [
        {
          status: 'running',
          temporal: { workflowId: 'wf-1' },
        },
        {
          status: 'completed',
          temporal: { workflowId: 'wf-2' },
        },
        {
          status: 'running',
          temporal: {},
        },
      ] as never,
      true,
    );

    expect(terminateSnapshotWorkflow).toHaveBeenCalledTimes(1);
    expect(terminateSnapshotWorkflow).toHaveBeenCalledWith('wf-1', true);
  });

  it('closes the Temporal connection during module destroy', async () => {
    (service as { connection: typeof mockConnection }).connection = mockConnection;

    await service.onModuleDestroy();

    expect(mockConnection.close).toHaveBeenCalledOnce();
  });
});
