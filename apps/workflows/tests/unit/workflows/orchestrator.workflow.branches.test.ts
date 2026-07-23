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
    startTime: new Date('2026-07-22T10:00:00.000Z'),
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
  postSnapshotScores?: ReturnType<typeof vi.fn>;
  submitCustomRawScores?: ReturnType<typeof vi.fn>;
}) {
  const getSnapshot = args.getSnapshot ?? vi.fn();
  const updateSnapshot = args.updateSnapshot ?? vi.fn().mockResolvedValue(undefined);
  const getAlgorithmDefinition = args.getAlgorithmDefinition ?? vi.fn();
  const resolveDependency = args.resolveDependency ?? vi.fn().mockResolvedValue(undefined);
  const runTypescriptAlgorithm = args.runTypescriptAlgorithm ?? vi.fn();
  const postSnapshotScores =
    args.postSnapshotScores ?? vi.fn().mockResolvedValue({ posted: 0, ok: 0, failed: 0, dropped: 0, skipped: 0 });
  const submitCustomRawScores = args.submitCustomRawScores ?? vi.fn().mockResolvedValue({ children: [] });

  return {
    getSnapshot,
    updateSnapshot,
    getAlgorithmDefinition,
    resolveDependency,
    runTypescriptAlgorithm,
    postSnapshotScores,
    submitCustomRawScores,
    implementation: () =>
      ({
        getSnapshot,
        updateSnapshot,
        getAlgorithmDefinition,
        resolveDependency,
        runTypescriptAlgorithm,
        postSnapshotScores,
        submitCustomRawScores,
      }) as never,
  };
}

function combinedSnapshot() {
  return {
    status: SnapshotStatus.queued,
    algorithmPresetFrozen: {
      key: 'custom_score',
      version: '1.0.0',
      inputs: [
        { key: 'dids', value: 'uploads/dids.json' },
        {
          key: 'sub_algorithms',
          value: [{ algorithm_key: 'voting_engagement', algorithm_version: '1.0.0', weight: 1, inputs: [] }],
        },
      ],
    },
  };
}

function combinedDefinition() {
  return {
    algorithmDefinition: {
      key: 'custom_score',
      version: '1.0.0',
      kind: 'combined',
      runtime: 'typescript',
      inputs: [{ key: 'sub_algorithms', type: 'sub_algorithm', sharedInputKeys: ['dids'] }],
    },
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

  it('submits combined raw scores before completion and skips the best-effort post', async () => {
    const { proxyActivities, isCancellation } = await loadWorkflowModule();
    const activities = createProxyActivitiesMock({
      getSnapshot: vi.fn().mockResolvedValue(combinedSnapshot()),
      getAlgorithmDefinition: vi.fn().mockResolvedValue(combinedDefinition()),
      runTypescriptAlgorithm: vi.fn().mockResolvedValue({
        outputs: { voting_engagement: 'snapshots/snapshot-1/voting_engagement.csv' },
      }),
    });
    proxyActivities.mockImplementation(activities.implementation);
    isCancellation.mockReturnValue(false);

    const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');

    await OrchestratorWorkflow({ snapshotId: 'snapshot-1' });

    expect(activities.submitCustomRawScores).toHaveBeenCalledTimes(1);
    expect(activities.submitCustomRawScores).toHaveBeenCalledWith({
      snapshotId: 'snapshot-1',
      algorithmPresetFrozen: expect.objectContaining({ key: 'custom_score' }),
      outputs: { voting_engagement: 'snapshots/snapshot-1/voting_engagement.csv' },
      timestamp: '2026-07-22T10:00:00.000Z',
    });

    // The submission happens before the snapshot is marked completed, and the
    // combined path never uses the best-effort post.
    const submitOrder = activities.submitCustomRawScores.mock.invocationCallOrder[0];
    const completedOrder = activities.updateSnapshot.mock.invocationCallOrder[1];
    expect(submitOrder).toBeLessThan(completedOrder);
    expect(activities.updateSnapshot).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ snapshotId: 'snapshot-1', status: SnapshotStatus.completed }),
    );
    expect(activities.postSnapshotScores).not.toHaveBeenCalled();
  });

  it('marks the snapshot as failed when the combined raw-score submission fails', async () => {
    const { proxyActivities, isCancellation } = await loadWorkflowModule();
    const submissionError = new Error('DeepID transport failure');
    const activities = createProxyActivitiesMock({
      getSnapshot: vi.fn().mockResolvedValue(combinedSnapshot()),
      getAlgorithmDefinition: vi.fn().mockResolvedValue(combinedDefinition()),
      runTypescriptAlgorithm: vi.fn().mockResolvedValue({
        outputs: { voting_engagement: 'snapshots/snapshot-1/voting_engagement.csv' },
      }),
      submitCustomRawScores: vi.fn().mockRejectedValue(submissionError),
    });
    proxyActivities.mockImplementation(activities.implementation);
    isCancellation.mockReturnValue(false);

    const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');

    await expect(OrchestratorWorkflow({ snapshotId: 'snapshot-1' })).rejects.toThrow(submissionError);

    expect(activities.updateSnapshot).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        snapshotId: 'snapshot-1',
        status: SnapshotStatus.failed,
        error: { message: 'DeepID transport failure' },
      }),
    );
    expect(activities.updateSnapshot).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: SnapshotStatus.completed }),
    );
  });

  it('keeps the best-effort post for standalone snapshots and never calls the custom submission', async () => {
    const { proxyActivities, isCancellation } = await loadWorkflowModule();
    const activities = createProxyActivitiesMock({
      getSnapshot: vi.fn().mockResolvedValue({
        status: SnapshotStatus.queued,
        algorithmPresetFrozen: {
          key: 'voting_engagement',
          version: '1.0.0',
          inputs: [],
        },
      }),
      getAlgorithmDefinition: vi.fn().mockResolvedValue({
        algorithmDefinition: {
          key: 'voting_engagement',
          version: '1.0.0',
          runtime: 'typescript',
          dependencies: [],
        },
      }),
      runTypescriptAlgorithm: vi.fn().mockResolvedValue({
        outputs: { voting_engagement: 'snapshots/snapshot-1/voting_engagement.csv' },
      }),
    });
    proxyActivities.mockImplementation(activities.implementation);
    isCancellation.mockReturnValue(false);

    const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');

    await OrchestratorWorkflow({ snapshotId: 'snapshot-1' });

    expect(activities.postSnapshotScores).toHaveBeenCalledTimes(1);
    expect(activities.submitCustomRawScores).not.toHaveBeenCalled();
  });
});
