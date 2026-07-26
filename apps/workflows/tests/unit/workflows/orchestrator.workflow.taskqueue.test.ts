import { API_SNAPSHOT_ACTIVITIES_TASK_QUEUE } from '@reputo/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  ACTIVITY_MAX_ATTEMPTS,
  algorithmTypescriptTaskQueue,
  DB_ACTIVITY_TIMEOUT,
  DEEP_ID_ENCRYPTED_SUBMISSION_TIMEOUT,
  DEEP_ID_POST_SCORES_HEARTBEAT_TIMEOUT,
  DEEP_ID_READINESS_CHECK_TIMEOUT,
  DEPENDENCY_RESOLUTION_TIMEOUT,
  ONCHAIN_DATA_DEPENDENCY_RESOLUTION_TIMEOUT,
  onchainDataTaskQueue,
  SnapshotStatus,
} from '../../../src/shared/constants/index.js';

vi.mock('@temporalio/workflow', () => ({
  proxyActivities: vi.fn(),
  workflowInfo: vi.fn(),
  sleep: vi.fn(async () => {}),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function readyReadinessResult() {
  return {
    ready: true,
    counts: { complete: 1, potentiallyComplete: 0, incomplete: 0 },
    scannedUsers: 1,
    pages: 1,
    cursorRestarts: 0,
  };
}

function submittedEncryptedResult() {
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
  };
}

describe('OrchestratorWorkflow task queue routing', () => {
  it('routes dependency resolution to the orchestrator task queue and algorithm execution to the algorithm task queue', async () => {
    vi.resetModules();

    const temporalWorkflow = await import('@temporalio/workflow');
    const proxyActivities = vi.mocked(temporalWorkflow.proxyActivities);
    const workflowInfo = vi.mocked(temporalWorkflow.workflowInfo);

    workflowInfo.mockReturnValue({
      workflowId: 'wf-1',
      runId: 'run-1',
      taskQueue: 'orchestrator-q',
    } as never);

    const recordedOptions: Array<Record<string, unknown>> = [];

    const getSnapshot = vi.fn().mockResolvedValue({
      status: SnapshotStatus.queued,
      algorithmPresetFrozen: {
        key: 'algo-key',
        version: '1.0.0',
        inputs: [],
      },
    });
    const updateSnapshot = vi.fn().mockResolvedValue(undefined);
    const getAlgorithmDefinition = vi.fn().mockResolvedValue({
      algorithmDefinition: {
        key: 'algo-key',
        version: '1.0.0',
        runtime: 'typescript',
        dependencies: [{ key: 'deepfunding-portal-api' }],
      },
    });
    const resolveDependency = vi.fn().mockResolvedValue(undefined);
    const runTypescriptAlgorithm = vi.fn().mockResolvedValue({
      outputs: { some_key: 'some_value' },
    });

    proxyActivities.mockImplementation((opts) => {
      recordedOptions.push(opts as Record<string, unknown>);
      return {
        getSnapshot,
        updateSnapshot,
        getAlgorithmDefinition,
        resolveDependency,
        runTypescriptAlgorithm,
      } as never;
    });

    const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');

    await OrchestratorWorkflow({
      snapshotId: 'snapshot-1',
    });

    expect(recordedOptions[0]).toMatchObject({
      taskQueue: API_SNAPSHOT_ACTIVITIES_TASK_QUEUE,
      startToCloseTimeout: DB_ACTIVITY_TIMEOUT,
      retry: { maximumAttempts: ACTIVITY_MAX_ATTEMPTS },
    });
    expect(recordedOptions[2]).toMatchObject({
      taskQueue: 'orchestrator-q',
      startToCloseTimeout: DEPENDENCY_RESOLUTION_TIMEOUT,
      heartbeatTimeout: expect.any(String),
    });
    expect(recordedOptions[3]).toMatchObject({
      taskQueue: onchainDataTaskQueue,
      startToCloseTimeout: ONCHAIN_DATA_DEPENDENCY_RESOLUTION_TIMEOUT,
    });
    expect(recordedOptions[3]).not.toHaveProperty('heartbeatTimeout');
    expect(recordedOptions[4]).toMatchObject({ taskQueue: algorithmTypescriptTaskQueue });
    // The best-effort post proxy is created after the phases, so the DeepID
    // proxies sit one index earlier than before the finalizer restructure.
    expect(recordedOptions[6]).toMatchObject({
      taskQueue: 'orchestrator-q',
      startToCloseTimeout: DEEP_ID_READINESS_CHECK_TIMEOUT,
      heartbeatTimeout: DEEP_ID_POST_SCORES_HEARTBEAT_TIMEOUT,
      retry: { maximumAttempts: ACTIVITY_MAX_ATTEMPTS },
    });
    expect(recordedOptions[7]).toMatchObject({
      taskQueue: 'orchestrator-q',
      startToCloseTimeout: DEEP_ID_ENCRYPTED_SUBMISSION_TIMEOUT,
      heartbeatTimeout: DEEP_ID_POST_SCORES_HEARTBEAT_TIMEOUT,
      retry: { maximumAttempts: ACTIVITY_MAX_ATTEMPTS },
    });
    expect(resolveDependency).toHaveBeenCalledWith({
      dependencyKey: 'deepfunding-portal-api',
      snapshotId: 'snapshot-1',
    });
  });

  it('routes onchain-data dependency resolution to the onchain task queue', async () => {
    vi.resetModules();

    const temporalWorkflow = await import('@temporalio/workflow');
    const proxyActivities = vi.mocked(temporalWorkflow.proxyActivities);
    const workflowInfo = vi.mocked(temporalWorkflow.workflowInfo);

    workflowInfo.mockReturnValue({
      workflowId: 'wf-1',
      runId: 'run-1',
      taskQueue: 'orchestrator-q',
    } as never);

    const recordedOptions: Array<Record<string, unknown>> = [];

    const getSnapshot = vi.fn().mockResolvedValue({
      status: SnapshotStatus.queued,
      algorithmPresetFrozen: {
        key: 'algo-key',
        version: '1.0.0',
        inputs: [],
      },
    });
    const updateSnapshot = vi.fn().mockResolvedValue(undefined);
    const getAlgorithmDefinition = vi.fn().mockResolvedValue({
      algorithmDefinition: {
        key: 'algo-key',
        version: '1.0.0',
        runtime: 'typescript',
        dependencies: [{ key: 'onchain-data' }],
      },
    });
    const resolveDependency = vi.fn().mockResolvedValue(undefined);
    const runTypescriptAlgorithm = vi.fn().mockResolvedValue({
      outputs: { some_key: 'some_value' },
    });

    proxyActivities.mockImplementation((opts) => {
      recordedOptions.push(opts as Record<string, unknown>);
      return {
        getSnapshot,
        updateSnapshot,
        getAlgorithmDefinition,
        resolveDependency,
        runTypescriptAlgorithm,
      } as never;
    });

    const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');

    await OrchestratorWorkflow({
      snapshotId: 'snapshot-1',
    });

    expect(recordedOptions[3]).toMatchObject({
      taskQueue: onchainDataTaskQueue,
      startToCloseTimeout: ONCHAIN_DATA_DEPENDENCY_RESOLUTION_TIMEOUT,
    });
    expect(recordedOptions[3]).not.toHaveProperty('heartbeatTimeout');
    expect(resolveDependency).toHaveBeenCalledWith({
      dependencyKey: 'onchain-data',
      snapshotId: 'snapshot-1',
      syncTargets: [],
    });
  });

  it('deduplicates dependency keys contributed by both the root combined algorithm and its children', async () => {
    vi.resetModules();

    const temporalWorkflow = await import('@temporalio/workflow');
    const proxyActivities = vi.mocked(temporalWorkflow.proxyActivities);
    const workflowInfo = vi.mocked(temporalWorkflow.workflowInfo);

    workflowInfo.mockReturnValue({
      workflowId: 'wf-1',
      runId: 'run-1',
      taskQueue: 'orchestrator-q',
      startTime: new Date('2026-07-22T10:00:00.000Z'),
    } as never);

    const getSnapshot = vi.fn().mockResolvedValue({
      status: SnapshotStatus.queued,
      algorithmPresetFrozen: {
        key: 'custom_score',
        version: '1.0.0',
        inputs: [
          { key: 'dids', value: 'uploads/dids.json' },
          {
            key: 'sub_algorithms',
            value: [
              {
                algorithm_key: 'proposal_engagement',
                algorithm_version: '1.0.0',
                weight: 1,
                inputs: [],
              },
            ],
          },
        ],
      },
    });
    const updateSnapshot = vi.fn().mockResolvedValue(undefined);
    const getAlgorithmDefinition = vi
      .fn()
      .mockResolvedValueOnce({
        algorithmDefinition: {
          key: 'custom_score',
          version: '1.0.0',
          kind: 'combined',
          runtime: 'typescript',
          dependencies: [{ key: 'deepfunding-portal-api' }],
          inputs: [
            {
              key: 'sub_algorithms',
              type: 'sub_algorithm',
              sharedInputKeys: ['dids'],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        algorithmDefinition: {
          key: 'proposal_engagement',
          version: '1.0.0',
          runtime: 'typescript',
          dependencies: [{ key: 'deepfunding-portal-api' }],
          inputs: [],
        },
      });
    const resolveDependency = vi.fn().mockResolvedValue(undefined);
    const runTypescriptAlgorithm = vi.fn().mockResolvedValue({
      outputs: {
        proposal_engagement: 'snapshots/snapshot-1/proposal_engagement.csv',
        custom_score_details: 'snapshots/snapshot-1/custom_score_details.json',
      },
    });
    const submitCustomRawScores = vi.fn().mockResolvedValue({ children: [] });
    const checkEncryptionReadiness = vi.fn().mockResolvedValue(readyReadinessResult());
    const submitCustomEncryptedScores = vi.fn().mockResolvedValue(submittedEncryptedResult());

    proxyActivities.mockImplementation(
      () =>
        ({
          getSnapshot,
          updateSnapshot,
          getAlgorithmDefinition,
          resolveDependency,
          runTypescriptAlgorithm,
          submitCustomRawScores,
          checkEncryptionReadiness,
          submitCustomEncryptedScores,
        }) as never,
    );

    const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');

    await OrchestratorWorkflow({
      snapshotId: 'snapshot-1',
    });

    expect(resolveDependency).toHaveBeenCalledTimes(1);
    expect(resolveDependency).toHaveBeenCalledWith({
      dependencyKey: 'deepfunding-portal-api',
      snapshotId: 'snapshot-1',
    });
    expect(runTypescriptAlgorithm).toHaveBeenCalledTimes(1);

    // The combined snapshot submits its native child scores before completion,
    // passing the compute result's outputs and one run-consistent timestamp.
    expect(submitCustomRawScores).toHaveBeenCalledTimes(1);
    expect(submitCustomRawScores).toHaveBeenCalledWith({
      snapshotId: 'snapshot-1',
      algorithmPresetFrozen: expect.objectContaining({ key: 'custom_score' }),
      outputs: {
        proposal_engagement: 'snapshots/snapshot-1/proposal_engagement.csv',
        custom_score_details: 'snapshots/snapshot-1/custom_score_details.json',
      },
      timestamp: '2026-07-22T10:00:00.000Z',
    });

    expect(checkEncryptionReadiness).toHaveBeenCalledTimes(1);
    expect(checkEncryptionReadiness).toHaveBeenCalledWith({
      snapshotId: 'snapshot-1',
      algorithmPresetFrozen: expect.objectContaining({ key: 'custom_score' }),
    });
  });

  it('merges combined child dependencies and deduplicates onchain sync targets before root compute', async () => {
    vi.resetModules();

    const temporalWorkflow = await import('@temporalio/workflow');
    const proxyActivities = vi.mocked(temporalWorkflow.proxyActivities);
    const workflowInfo = vi.mocked(temporalWorkflow.workflowInfo);

    workflowInfo.mockReturnValue({
      workflowId: 'wf-1',
      runId: 'run-1',
      taskQueue: 'orchestrator-q',
      startTime: new Date('2026-07-22T10:00:00.000Z'),
    } as never);

    const getSnapshot = vi.fn().mockResolvedValue({
      status: SnapshotStatus.queued,
      algorithmPresetFrozen: {
        key: 'custom_score',
        version: '1.0.0',
        inputs: [
          { key: 'dids', value: 'uploads/dids.json' },
          {
            key: 'sub_algorithms',
            value: [
              {
                algorithm_key: 'token_value_over_time',
                algorithm_version: '1.0.0',
                weight: 1,
                inputs: [
                  {
                    key: 'selected_resources',
                    value: [
                      { chain: 'ethereum', resource_key: 'fet_staking_1' },
                      { chain: 'cardano', resource_key: 'fet_token' },
                    ],
                  },
                ],
              },
              {
                algorithm_key: 'proposal_engagement',
                algorithm_version: '1.0.0',
                weight: 1,
                inputs: [],
              },
              {
                algorithm_key: 'token_value_over_time',
                algorithm_version: '1.0.0',
                weight: 2,
                inputs: [
                  {
                    key: 'selected_resources',
                    value: [
                      { chain: 'ethereum', resource_key: 'fet_token' },
                      { chain: 'ethereum', resource_key: 'fet_staking_2' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const updateSnapshot = vi.fn().mockResolvedValue(undefined);
    const getAlgorithmDefinition = vi
      .fn()
      .mockResolvedValueOnce({
        algorithmDefinition: {
          key: 'custom_score',
          version: '1.0.0',
          kind: 'combined',
          runtime: 'typescript',
          inputs: [
            {
              key: 'sub_algorithms',
              type: 'sub_algorithm',
              sharedInputKeys: ['dids'],
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        algorithmDefinition: {
          key: 'token_value_over_time',
          version: '1.0.0',
          runtime: 'typescript',
          dependencies: [{ key: 'onchain-data' }],
          inputs: [
            {
              key: 'selected_resources',
              uiHint: {
                resourceCatalog: {
                  chains: [
                    {
                      key: 'ethereum',
                      resources: [
                        {
                          key: 'fet_token',
                          kind: 'token',
                          identifier: '0xToken',
                          tokenIdentifier: '0xToken',
                        },
                        {
                          key: 'fet_staking_1',
                          kind: 'contract',
                          identifier: '0xStake1',
                          tokenIdentifier: '0xToken',
                        },
                        {
                          key: 'fet_staking_2',
                          kind: 'contract',
                          identifier: '0xStake2',
                          tokenIdentifier: '0xToken',
                        },
                      ],
                    },
                    {
                      key: 'cardano',
                      resources: [
                        {
                          key: 'fet_token',
                          kind: 'token',
                          identifier: 'asset1',
                          tokenIdentifier: 'asset1',
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        algorithmDefinition: {
          key: 'proposal_engagement',
          version: '1.0.0',
          runtime: 'typescript',
          dependencies: [{ key: 'deepfunding-portal-api' }],
          inputs: [],
        },
      })
      .mockResolvedValueOnce({
        algorithmDefinition: {
          key: 'token_value_over_time',
          version: '1.0.0',
          runtime: 'typescript',
          dependencies: [{ key: 'onchain-data' }],
          inputs: [
            {
              key: 'selected_resources',
              uiHint: {
                resourceCatalog: {
                  chains: [
                    {
                      key: 'ethereum',
                      resources: [
                        {
                          key: 'fet_token',
                          kind: 'token',
                          identifier: '0xToken',
                          tokenIdentifier: '0xToken',
                        },
                        {
                          key: 'fet_staking_1',
                          kind: 'contract',
                          identifier: '0xStake1',
                          tokenIdentifier: '0xToken',
                        },
                        {
                          key: 'fet_staking_2',
                          kind: 'contract',
                          identifier: '0xStake2',
                          tokenIdentifier: '0xToken',
                        },
                      ],
                    },
                    {
                      key: 'cardano',
                      resources: [
                        {
                          key: 'fet_token',
                          kind: 'token',
                          identifier: 'asset1',
                          tokenIdentifier: 'asset1',
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        },
      });
    const resolveDependency = vi.fn().mockResolvedValue(undefined);
    const runTypescriptAlgorithm = vi.fn().mockResolvedValue({
      outputs: { token_value_over_time: 'snapshots/snapshot-1/token_value_over_time.csv' },
    });
    const submitCustomRawScores = vi.fn().mockResolvedValue({ children: [] });
    const checkEncryptionReadiness = vi.fn().mockResolvedValue(readyReadinessResult());
    const submitCustomEncryptedScores = vi.fn().mockResolvedValue(submittedEncryptedResult());

    proxyActivities.mockImplementation(
      () =>
        ({
          getSnapshot,
          updateSnapshot,
          getAlgorithmDefinition,
          resolveDependency,
          runTypescriptAlgorithm,
          submitCustomRawScores,
          checkEncryptionReadiness,
          submitCustomEncryptedScores,
        }) as never,
    );

    const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');

    await OrchestratorWorkflow({
      snapshotId: 'snapshot-1',
    });

    expect(getAlgorithmDefinition).toHaveBeenNthCalledWith(1, {
      key: 'custom_score',
      version: '1.0.0',
    });
    expect(getAlgorithmDefinition).toHaveBeenNthCalledWith(2, {
      key: 'token_value_over_time',
      version: '1.0.0',
    });
    expect(getAlgorithmDefinition).toHaveBeenNthCalledWith(3, {
      key: 'proposal_engagement',
      version: '1.0.0',
    });
    expect(getAlgorithmDefinition).toHaveBeenNthCalledWith(4, {
      key: 'token_value_over_time',
      version: '1.0.0',
    });

    expect(resolveDependency).toHaveBeenCalledTimes(2);
    expect(resolveDependency).toHaveBeenNthCalledWith(1, {
      dependencyKey: 'onchain-data',
      snapshotId: 'snapshot-1',
      syncTargets: [
        { chain: 'ethereum', identifier: '0xToken' },
        { chain: 'cardano', identifier: 'asset1' },
      ],
    });
    expect(resolveDependency).toHaveBeenNthCalledWith(2, {
      dependencyKey: 'deepfunding-portal-api',
      snapshotId: 'snapshot-1',
    });
    expect(runTypescriptAlgorithm).toHaveBeenCalledTimes(1);
  });
});
