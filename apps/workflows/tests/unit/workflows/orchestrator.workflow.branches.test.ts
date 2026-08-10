import { ApplicationFailure, CancelledFailure } from '@temporalio/workflow';
import { describe, expect, it, vi } from 'vitest';
import { SnapshotStatus } from '../../../src/shared/constants/index.js';

// Spread the real module so instanceof TemporalFailure/ApplicationFailure checks stay genuine.
vi.mock('@temporalio/workflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@temporalio/workflow')>();
  return {
    ...actual,
    proxyActivities: vi.fn(),
    workflowInfo: vi.fn(),
    isCancellation: vi.fn(),
    sleep: vi.fn(async () => {}),
    CancellationScope: {
      nonCancellable: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    },
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

async function loadWorkflowModule() {
  vi.resetModules();
  const temporalWorkflow = await import('@temporalio/workflow');
  const proxyActivities = vi.mocked(temporalWorkflow.proxyActivities);
  const workflowInfo = vi.mocked(temporalWorkflow.workflowInfo);
  const isCancellation = vi.mocked(temporalWorkflow.isCancellation);
  const sleep = vi.mocked(temporalWorkflow.sleep);
  // The mock factory result is cached across vi.resetModules; give each test a clean timer mock.
  sleep.mockReset();
  sleep.mockImplementation(async () => {});

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
    sleep,
  };
}

function readinessResult(overrides: Record<string, unknown> = {}) {
  return {
    ready: true,
    counts: { complete: 1, potentiallyComplete: 0, incomplete: 0 },
    scannedUsers: 1,
    pages: 1,
    cursorRestarts: 0,
    lastRequestId: 'req-1',
    ...overrides,
  };
}

function rawSubmissionResult() {
  return {
    children: [
      {
        scoreType: 'voting_engagement',
        csvKey: 'snapshots/snapshot-1/voting_engagement.csv',
        observation: { method: 'observed_min_max', min: 0, max: 10 },
        posted: 3,
        ok: 3,
        dropped: 0,
        rejected: 0,
        lastRequestId: 'req-raw',
      },
    ],
  };
}

function encryptedSubmissionResult(overrides: Record<string, unknown> = {}) {
  return {
    outcome: 'submitted',
    complete: 1,
    incomplete: 0,
    scannedUsers: 1,
    pages: 1,
    cursorRestarts: 0,
    submitted: 1,
    batches: 1,
    registeredKeys: 1,
    lastRequestId: 'req-encr',
    ...overrides,
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
  checkEncryptionReadiness?: ReturnType<typeof vi.fn>;
  submitCustomEncryptedScores?: ReturnType<typeof vi.fn>;
}) {
  const getSnapshot = args.getSnapshot ?? vi.fn();
  const updateSnapshot = args.updateSnapshot ?? vi.fn().mockResolvedValue(undefined);
  const getAlgorithmDefinition = args.getAlgorithmDefinition ?? vi.fn();
  const resolveDependency = args.resolveDependency ?? vi.fn().mockResolvedValue(undefined);
  const runTypescriptAlgorithm = args.runTypescriptAlgorithm ?? vi.fn();
  const postSnapshotScores =
    args.postSnapshotScores ?? vi.fn().mockResolvedValue({ posted: 0, ok: 0, failed: 0, dropped: 0, skipped: 0 });
  const submitCustomRawScores = args.submitCustomRawScores ?? vi.fn().mockResolvedValue(rawSubmissionResult());
  const checkEncryptionReadiness = args.checkEncryptionReadiness ?? vi.fn().mockResolvedValue(readinessResult());
  const submitCustomEncryptedScores =
    args.submitCustomEncryptedScores ?? vi.fn().mockResolvedValue(encryptedSubmissionResult());

  return {
    getSnapshot,
    updateSnapshot,
    getAlgorithmDefinition,
    resolveDependency,
    runTypescriptAlgorithm,
    postSnapshotScores,
    submitCustomRawScores,
    checkEncryptionReadiness,
    submitCustomEncryptedScores,
    implementation: () =>
      ({
        getSnapshot,
        updateSnapshot,
        getAlgorithmDefinition,
        resolveDependency,
        runTypescriptAlgorithm,
        postSnapshotScores,
        submitCustomRawScores,
        checkEncryptionReadiness,
        submitCustomEncryptedScores,
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

    const error = await OrchestratorWorkflow({ snapshotId: 'snapshot-1' }).then(
      () => {
        throw new Error('expected the workflow to reject');
      },
      (thrown) => thrown as Error,
    );

    // Errors thrown before the algorithm phase must still fail the run, not retry the task.
    expect(error.message).toContain("Cannot destructure property 'algorithmDefinition'");
    expect(error).toBeInstanceOf(ApplicationFailure);

    expect(activities.updateSnapshot).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        snapshotId: 'snapshot-1',
        status: SnapshotStatus.running,
      }),
    );
    // The definition phase now sits inside the run-wide failure handler, so
    // the row is finalized instead of being stranded in `running`.
    expect(activities.updateSnapshot).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        snapshotId: 'snapshot-1',
        status: SnapshotStatus.failed,
        error: { message: expect.stringContaining("Cannot destructure property 'algorithmDefinition'") },
      }),
    );
    expect(activities.updateSnapshot).toHaveBeenCalledTimes(2);
  });

  it('marks the snapshot as failed when the definition lookup activity fails', async () => {
    const { proxyActivities, isCancellation } = await loadWorkflowModule();
    const lookupError = ApplicationFailure.create({ message: 'definition service unavailable' });
    const activities = createProxyActivitiesMock({
      getSnapshot: vi.fn().mockResolvedValue({
        status: SnapshotStatus.queued,
        algorithmPresetFrozen: {
          key: 'algo-key',
          version: '1.0.0',
          inputs: [],
        },
      }),
      getAlgorithmDefinition: vi.fn().mockRejectedValue(lookupError),
    });
    proxyActivities.mockImplementation(activities.implementation);
    isCancellation.mockReturnValue(false);

    const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');

    await expect(OrchestratorWorkflow({ snapshotId: 'snapshot-1' })).rejects.toBe(lookupError);

    expect(activities.updateSnapshot).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        snapshotId: 'snapshot-1',
        status: SnapshotStatus.failed,
        error: { message: 'definition service unavailable' },
      }),
    );
  });

  it('marks the snapshot as cancelled when dependency resolution is cancelled', async () => {
    const { proxyActivities, isCancellation } = await loadWorkflowModule();
    const cancelError = new CancelledFailure('cancelled during dependency resolution');
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
          dependencies: [{ key: 'deep-id' }],
        },
      }),
      resolveDependency: vi.fn().mockRejectedValue(cancelError),
    });
    proxyActivities.mockImplementation(activities.implementation);
    isCancellation.mockReturnValue(true);

    const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');

    await expect(OrchestratorWorkflow({ snapshotId: 'snapshot-1' })).rejects.toBe(cancelError);

    expect(activities.runTypescriptAlgorithm).not.toHaveBeenCalled();
    expect(activities.updateSnapshot).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        snapshotId: 'snapshot-1',
        status: SnapshotStatus.cancelled,
        error: { message: 'Workflow was cancelled' },
      }),
    );
  });

  it('skips the terminal write when the snapshot row was deleted mid-run', async () => {
    const { proxyActivities, isCancellation } = await loadWorkflowModule();
    const notFound = ApplicationFailure.create({
      message: 'Snapshot snapshot-1 not found',
      type: 'SnapshotNotFoundError',
      nonRetryable: true,
    });
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
      runTypescriptAlgorithm: vi.fn().mockRejectedValue(notFound),
    });
    proxyActivities.mockImplementation(activities.implementation);
    isCancellation.mockReturnValue(false);

    const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');

    await expect(OrchestratorWorkflow({ snapshotId: 'snapshot-1' })).rejects.toBe(notFound);

    // Only the initial `running` write — no failed/cancelled write for a row that is gone.
    expect(activities.updateSnapshot).toHaveBeenCalledTimes(1);
  });

  it('rethrows the original failure when the terminal status write itself fails', async () => {
    const { proxyActivities, isCancellation } = await loadWorkflowModule();
    const executionError = ApplicationFailure.create({ message: 'algorithm failed' });
    const updateSnapshot = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(ApplicationFailure.create({ message: 'db write failed' }));
    const activities = createProxyActivitiesMock({
      getSnapshot: vi.fn().mockResolvedValue({
        status: SnapshotStatus.queued,
        algorithmPresetFrozen: {
          key: 'algo-key',
          version: '1.0.0',
          inputs: [],
        },
      }),
      updateSnapshot,
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

    await expect(OrchestratorWorkflow({ snapshotId: 'snapshot-1' })).rejects.toBe(executionError);
  });

  it('converts a plain workflow error into a non-retryable ApplicationFailure and still marks the snapshot failed', async () => {
    const { proxyActivities, isCancellation } = await loadWorkflowModule();
    const activities = createProxyActivitiesMock({
      getSnapshot: vi.fn().mockResolvedValue({
        status: SnapshotStatus.queued,
        algorithmPresetFrozen: {
          key: 'algo-key',
          version: '1.0.0',
          inputs: [],
        },
      }),
      // `python` resolves a task queue but has no executable branch, so the
      // workflow itself throws UnsupportedAlgorithmError (a plain Error).
      getAlgorithmDefinition: vi.fn().mockResolvedValue({
        algorithmDefinition: {
          key: 'algo-key',
          version: '1.0.0',
          runtime: 'python',
          dependencies: [],
        },
      }),
    });
    proxyActivities.mockImplementation(activities.implementation);
    isCancellation.mockReturnValue(false);

    const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');

    const error = await OrchestratorWorkflow({ snapshotId: 'snapshot-1' }).then(
      () => {
        throw new Error('expected the workflow to reject');
      },
      (thrown) => thrown as ApplicationFailure,
    );

    expect(error).toBeInstanceOf(ApplicationFailure);
    expect(error.type).toBe('UnsupportedAlgorithmError');
    expect(error.nonRetryable).toBe(true);
    expect(error.message).toBe('Unsupported algorithm: algo-key');

    expect(activities.updateSnapshot).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        snapshotId: 'snapshot-1',
        status: SnapshotStatus.failed,
        error: { message: 'Unsupported algorithm: algo-key' },
      }),
    );
  });

  it('rethrows Temporal failures unchanged instead of re-wrapping them', async () => {
    const { proxyActivities, isCancellation } = await loadWorkflowModule();
    const temporalFailure = ApplicationFailure.create({ message: 'boom from an activity', type: 'SomeActivityError' });
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
      runTypescriptAlgorithm: vi.fn().mockRejectedValue(temporalFailure),
    });
    proxyActivities.mockImplementation(activities.implementation);
    isCancellation.mockReturnValue(false);

    const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');

    await expect(OrchestratorWorkflow({ snapshotId: 'snapshot-1' })).rejects.toBe(temporalFailure);
  });

  it('marks the snapshot as cancelled when algorithm execution is cancelled', async () => {
    const { proxyActivities, isCancellation } = await loadWorkflowModule();
    // Production cancellation surfaces as a TemporalFailure, never a plain Error.
    const cancelError = new CancelledFailure('cancelled by user');
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
    ).rejects.toBe(cancelError);

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
    // Production activity failures reach the workflow as TemporalFailures.
    const executionError = ApplicationFailure.create({ message: 'algorithm failed' });
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
    ).rejects.toBe(executionError);

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

    // The submission happens before the readiness poll, the poll before the
    // encrypted submission, that before the snapshot is marked completed, and
    // the combined path never uses the best-effort post.
    expect(activities.checkEncryptionReadiness).toHaveBeenCalledTimes(1);
    expect(activities.checkEncryptionReadiness).toHaveBeenCalledWith({
      snapshotId: 'snapshot-1',
      algorithmPresetFrozen: expect.objectContaining({ key: 'custom_score' }),
    });
    const submitOrder = activities.submitCustomRawScores.mock.invocationCallOrder[0];
    const readinessOrder = activities.checkEncryptionReadiness.mock.invocationCallOrder[0];
    const encryptedOrder = activities.submitCustomEncryptedScores.mock.invocationCallOrder[0];
    const completedOrder = activities.updateSnapshot.mock.invocationCallOrder[2];
    expect(submitOrder).toBeLessThan(readinessOrder);
    expect(readinessOrder).toBeLessThan(encryptedOrder);
    expect(encryptedOrder).toBeLessThan(completedOrder);
    expect(activities.updateSnapshot).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ snapshotId: 'snapshot-1', status: SnapshotStatus.completed }),
    );
    expect(activities.postSnapshotScores).not.toHaveBeenCalled();
  });

  it('persists the compute outputs while the combined snapshot is still running', async () => {
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

    // The mid-run persist carries the outputs but no status change, so the
    // snapshot stays running (and startedAt is not rewritten) while DeepID
    // encrypts; it also happens before the raw submission.
    const outputsPersist = activities.updateSnapshot.mock.calls[1][0];
    expect(outputsPersist).toMatchObject({
      snapshotId: 'snapshot-1',
      outputs: { voting_engagement: 'snapshots/snapshot-1/voting_engagement.csv' },
    });
    expect(outputsPersist.status).toBeUndefined();
    const persistOrder = activities.updateSnapshot.mock.invocationCallOrder[1];
    const submitOrder = activities.submitCustomRawScores.mock.invocationCallOrder[0];
    expect(persistOrder).toBeLessThan(submitOrder);
  });

  it('runs the encrypted lifecycle with the raw observations and the fixed run timestamp', async () => {
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

    expect(activities.submitCustomEncryptedScores).toHaveBeenCalledTimes(1);
    expect(activities.submitCustomEncryptedScores).toHaveBeenCalledWith({
      snapshotId: 'snapshot-1',
      algorithmPresetFrozen: expect.objectContaining({ key: 'custom_score' }),
      observations: [{ scoreType: 'voting_engagement', observation: { method: 'observed_min_max', min: 0, max: 10 } }],
      timestamp: '2026-07-22T10:00:00.000Z',
    });
  });

  it('returns to readiness polling when the processing pass finds a pending selected score', async () => {
    const { proxyActivities, isCancellation, sleep } = await loadWorkflowModule();
    const activities = createProxyActivitiesMock({
      getSnapshot: vi.fn().mockResolvedValue(combinedSnapshot()),
      getAlgorithmDefinition: vi.fn().mockResolvedValue(combinedDefinition()),
      runTypescriptAlgorithm: vi.fn().mockResolvedValue({
        outputs: { voting_engagement: 'snapshots/snapshot-1/voting_engagement.csv' },
      }),
      submitCustomEncryptedScores: vi
        .fn()
        .mockResolvedValueOnce(
          encryptedSubmissionResult({ outcome: 'pending_encryption', complete: 2, scannedUsers: 3 }),
        )
        .mockResolvedValue(encryptedSubmissionResult()),
    });
    proxyActivities.mockImplementation(activities.implementation);
    isCancellation.mockReturnValue(false);

    const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');

    await OrchestratorWorkflow({ snapshotId: 'snapshot-1' });

    // Round 1 polls once (ready), processes, finds pending; round 2 restarts
    // the poll schedule from its first delay, then the pass submits.
    expect(activities.checkEncryptionReadiness).toHaveBeenCalledTimes(2);
    expect(activities.submitCustomEncryptedScores).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls.map(([duration]) => duration)).toEqual([60_000, 60_000]);
    expect(activities.updateSnapshot).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ snapshotId: 'snapshot-1', status: SnapshotStatus.completed }),
    );
  });

  it('marks the snapshot as failed when the encrypted submission fails fatally and never completes it', async () => {
    const { proxyActivities, isCancellation } = await loadWorkflowModule();
    const submissionError = ApplicationFailure.create({
      message: 'DEEPID_ENCRYPTED_SUBMISSION_FATAL: DeepID rejected the final custom_score_encr entry',
      type: 'DEEPID_ENCRYPTED_SUBMISSION_FATAL',
      nonRetryable: true,
    });
    const activities = createProxyActivitiesMock({
      getSnapshot: vi.fn().mockResolvedValue(combinedSnapshot()),
      getAlgorithmDefinition: vi.fn().mockResolvedValue(combinedDefinition()),
      runTypescriptAlgorithm: vi.fn().mockResolvedValue({
        outputs: { voting_engagement: 'snapshots/snapshot-1/voting_engagement.csv' },
      }),
      submitCustomEncryptedScores: vi.fn().mockRejectedValue(submissionError),
    });
    proxyActivities.mockImplementation(activities.implementation);
    isCancellation.mockReturnValue(false);

    const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');

    await expect(OrchestratorWorkflow({ snapshotId: 'snapshot-1' })).rejects.toBe(submissionError);

    expect(activities.updateSnapshot).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        snapshotId: 'snapshot-1',
        status: SnapshotStatus.failed,
        error: { message: submissionError.message },
      }),
    );
    expect(activities.updateSnapshot).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: SnapshotStatus.completed }),
    );
  });

  it('keeps polling on the documented delays until readiness before completing', async () => {
    const { proxyActivities, isCancellation, sleep } = await loadWorkflowModule();
    const notReady = readinessResult({ ready: false, counts: { complete: 1, potentiallyComplete: 2, incomplete: 0 } });
    const activities = createProxyActivitiesMock({
      getSnapshot: vi.fn().mockResolvedValue(combinedSnapshot()),
      getAlgorithmDefinition: vi.fn().mockResolvedValue(combinedDefinition()),
      runTypescriptAlgorithm: vi.fn().mockResolvedValue({
        outputs: { voting_engagement: 'snapshots/snapshot-1/voting_engagement.csv' },
      }),
      checkEncryptionReadiness: vi
        .fn()
        .mockResolvedValueOnce(notReady)
        .mockResolvedValueOnce(notReady)
        .mockResolvedValue(readinessResult()),
    });
    proxyActivities.mockImplementation(activities.implementation);
    isCancellation.mockReturnValue(false);

    const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');

    await OrchestratorWorkflow({ snapshotId: 'snapshot-1' });

    expect(activities.checkEncryptionReadiness).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([duration]) => duration)).toEqual([60_000, 900_000, 3_600_000]);
    expect(activities.updateSnapshot).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ snapshotId: 'snapshot-1', status: SnapshotStatus.completed }),
    );
  });

  it('marks the snapshot as failed when the readiness poll fails fatally and never completes it', async () => {
    const { proxyActivities, isCancellation } = await loadWorkflowModule();
    const readinessError = ApplicationFailure.create({
      message:
        'DeepID users cursor expired on 4 consecutive passes: a full readiness pass cannot finish within the cursor lifetime',
      type: 'DEEPID_ENCRYPTION_READINESS_FATAL',
      nonRetryable: true,
    });
    const activities = createProxyActivitiesMock({
      getSnapshot: vi.fn().mockResolvedValue(combinedSnapshot()),
      getAlgorithmDefinition: vi.fn().mockResolvedValue(combinedDefinition()),
      runTypescriptAlgorithm: vi.fn().mockResolvedValue({
        outputs: { voting_engagement: 'snapshots/snapshot-1/voting_engagement.csv' },
      }),
      checkEncryptionReadiness: vi.fn().mockRejectedValue(readinessError),
    });
    proxyActivities.mockImplementation(activities.implementation);
    isCancellation.mockReturnValue(false);

    const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');

    await expect(OrchestratorWorkflow({ snapshotId: 'snapshot-1' })).rejects.toBe(readinessError);

    expect(activities.updateSnapshot).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        snapshotId: 'snapshot-1',
        status: SnapshotStatus.failed,
        error: { message: readinessError.message },
      }),
    );
    expect(activities.updateSnapshot).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: SnapshotStatus.completed }),
    );
  });

  it('stops polling cleanly when the workflow is cancelled during a readiness wait', async () => {
    const { proxyActivities, isCancellation, sleep } = await loadWorkflowModule();
    // A cancelled durable timer rejects with CancelledFailure in production.
    const cancelError = new CancelledFailure('timer cancelled');
    const activities = createProxyActivitiesMock({
      getSnapshot: vi.fn().mockResolvedValue(combinedSnapshot()),
      getAlgorithmDefinition: vi.fn().mockResolvedValue(combinedDefinition()),
      runTypescriptAlgorithm: vi.fn().mockResolvedValue({
        outputs: { voting_engagement: 'snapshots/snapshot-1/voting_engagement.csv' },
      }),
    });
    proxyActivities.mockImplementation(activities.implementation);
    isCancellation.mockReturnValue(true);
    sleep.mockRejectedValue(cancelError);

    const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');

    await expect(OrchestratorWorkflow({ snapshotId: 'snapshot-1' })).rejects.toBe(cancelError);

    expect(activities.checkEncryptionReadiness).not.toHaveBeenCalled();
    expect(activities.updateSnapshot).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ snapshotId: 'snapshot-1', status: SnapshotStatus.cancelled }),
    );
  });

  it('marks the snapshot as failed when the combined raw-score submission fails', async () => {
    const { proxyActivities, isCancellation } = await loadWorkflowModule();
    const submissionError = ApplicationFailure.create({ message: 'DeepID transport failure' });
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

    await expect(OrchestratorWorkflow({ snapshotId: 'snapshot-1' })).rejects.toBe(submissionError);

    expect(activities.updateSnapshot).toHaveBeenNthCalledWith(
      3,
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
