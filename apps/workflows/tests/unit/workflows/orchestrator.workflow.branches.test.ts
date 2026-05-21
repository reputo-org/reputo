import { describe, expect, it, vi } from 'vitest';
import { SnapshotStatus } from '../../../src/shared/constants/index.js';

vi.mock('@temporalio/workflow', () => ({
  proxyActivities: vi.fn(),
  workflowInfo: vi.fn(),
  isCancellation: vi.fn(),
  CancellationScope: {
    nonCancellable: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  },
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

async function loadWorkflowModule() {
  vi.resetModules();
  const temporalWorkflow = await import('@temporalio/workflow');
  const proxyActivities = vi.mocked(temporalWorkflow.proxyActivities);
  const workflowInfo = vi.mocked(temporalWorkflow.workflowInfo);
  const isCancellation = vi.mocked(temporalWorkflow.isCancellation);

  workflowInfo.mockReturnValue({
    workflowId: 'wf-1',
    runId: 'run-1',
    taskQueue: 'orchestrator-q',
  } as never);

  return {
    temporalWorkflow,
    proxyActivities,
    workflowInfo,
    isCancellation,
  };
}

function createProxyActivitiesMock(args: {
  getSnapshot?: ReturnType<typeof vi.fn>;
  updateSnapshot?: ReturnType<typeof vi.fn>;
  getAlgorithmDefinition?: ReturnType<typeof vi.fn>;
  resolveDependency?: ReturnType<typeof vi.fn>;
  runTypescriptAlgorithm?: ReturnType<typeof vi.fn>;
}) {
  const getSnapshot = args.getSnapshot ?? vi.fn();
  const updateSnapshot = args.updateSnapshot ?? vi.fn().mockResolvedValue(undefined);
  const getAlgorithmDefinition = args.getAlgorithmDefinition ?? vi.fn();
  const resolveDependency = args.resolveDependency ?? vi.fn().mockResolvedValue(undefined);
  const runTypescriptAlgorithm = args.runTypescriptAlgorithm ?? vi.fn();

  return {
    getSnapshot,
    updateSnapshot,
    getAlgorithmDefinition,
    resolveDependency,
    runTypescriptAlgorithm,
    implementation: () =>
      ({
        getSnapshot,
        updateSnapshot,
        getAlgorithmDefinition,
        resolveDependency,
        runTypescriptAlgorithm,
      }) as never,
  };
}

describe('OrchestratorWorkflow branches', () => {
  it('returns early when the snapshot is already completed', async () => {
    const { proxyActivities } = await loadWorkflowModule();
    const activities = createProxyActivitiesMock({
      getSnapshot: vi.fn().mockResolvedValue({
        status: SnapshotStatus.completed,
        algorithmPresetFrozen: {
          key: 'algo-key',
          version: '1.0.0',
          inputs: [],
        },
      }),
    });
    proxyActivities.mockImplementation(activities.implementation);

    const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');

    await expect(
      OrchestratorWorkflow({
        snapshotId: 'snapshot-1',
      }),
    ).resolves.toBeUndefined();

    expect(activities.updateSnapshot).not.toHaveBeenCalled();
    expect(activities.getAlgorithmDefinition).not.toHaveBeenCalled();
  });

  it('marks the snapshot as failed when preset routing metadata is missing', async () => {
    const { proxyActivities } = await loadWorkflowModule();
    const activities = createProxyActivitiesMock({
      getSnapshot: vi.fn().mockResolvedValue({
        status: SnapshotStatus.queued,
        algorithmPresetFrozen: {
          key: '',
          version: '',
          inputs: [],
        },
      }),
    });
    proxyActivities.mockImplementation(activities.implementation);

    const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');

    await expect(
      OrchestratorWorkflow({
        snapshotId: 'snapshot-1',
      }),
    ).rejects.toThrow("Cannot destructure property 'algorithmDefinition'");

    expect(activities.updateSnapshot).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        snapshotId: 'snapshot-1',
        status: SnapshotStatus.running,
      }),
    );
    expect(activities.updateSnapshot).toHaveBeenCalledTimes(1);
  });

  it('marks the snapshot as cancelled when algorithm execution is cancelled', async () => {
    const { proxyActivities, isCancellation } = await loadWorkflowModule();
    const cancelError = new Error('cancelled by user');
    const activities = createProxyActivitiesMock({
      getSnapshot: vi.fn().mockResolvedValue({
        status: SnapshotStatus.queued,
        algorithmPresetFrozen: {
          key: 'algo-key',
          version: '1.0.0',
          inputs: [],
        },
      }),
      getAlgorithmDefinition: vi.fn().mockResolvedValue({
        algorithmDefinition: {
          key: 'algo-key',
          version: '1.0.0',
          runtime: 'typescript',
          dependencies: [],
        },
      }),
      runTypescriptAlgorithm: vi.fn().mockRejectedValue(cancelError),
    });
    proxyActivities.mockImplementation(activities.implementation);
    isCancellation.mockReturnValue(true);

    const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');

    await expect(
      OrchestratorWorkflow({
        snapshotId: 'snapshot-1',
      }),
    ).rejects.toThrow(cancelError);

    expect(activities.updateSnapshot).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        snapshotId: 'snapshot-1',
        status: SnapshotStatus.running,
      }),
    );
    expect(activities.updateSnapshot).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        snapshotId: 'snapshot-1',
        status: SnapshotStatus.cancelled,
        error: {
          message: 'Workflow was cancelled',
        },
      }),
    );
  });

  it('marks the snapshot as failed when algorithm execution throws', async () => {
    const { proxyActivities, isCancellation } = await loadWorkflowModule();
    const executionError = new Error('algorithm failed');
    const activities = createProxyActivitiesMock({
      getSnapshot: vi.fn().mockResolvedValue({
        status: SnapshotStatus.queued,
        algorithmPresetFrozen: {
          key: 'algo-key',
          version: '1.0.0',
          inputs: [],
        },
      }),
      getAlgorithmDefinition: vi.fn().mockResolvedValue({
        algorithmDefinition: {
          key: 'algo-key',
          version: '1.0.0',
          runtime: 'typescript',
          dependencies: [],
        },
      }),
      runTypescriptAlgorithm: vi.fn().mockRejectedValue(executionError),
    });
    proxyActivities.mockImplementation(activities.implementation);
    isCancellation.mockReturnValue(false);

    const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');

    await expect(
      OrchestratorWorkflow({
        snapshotId: 'snapshot-1',
      }),
    ).rejects.toThrow(executionError);

    expect(activities.updateSnapshot).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        snapshotId: 'snapshot-1',
        status: SnapshotStatus.failed,
        error: {
          message: 'algorithm failed',
        },
      }),
    );
  });
});
