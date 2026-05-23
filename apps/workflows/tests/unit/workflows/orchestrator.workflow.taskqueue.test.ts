import { API_SNAPSHOT_ACTIVITIES_TASK_QUEUE } from '@reputo/contracts';
import { describe, expect, it, vi } from 'vitest';
import {
  ACTIVITY_MAX_ATTEMPTS,
  algorithmTypescriptTaskQueue,
  DB_ACTIVITY_TIMEOUT,
  DEPENDENCY_RESOLUTION_TIMEOUT,
  ONCHAIN_DATA_DEPENDENCY_RESOLUTION_TIMEOUT,
  onchainDataTaskQueue,
  SnapshotStatus,
} from '../../../src/shared/constants/index.js';

vi.mock('@temporalio/workflow', () => ({
  proxyActivities: vi.fn(),
  workflowInfo: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

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
      // Return a superset of activity functions; callers destructure the ones they need.
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

    // Order:
    // 0: ApiSnapshotActivities — API task queue (module import)
    // 1: AlgorithmLibraryActivities (module import)
    // 2: DependencyResolverActivities — orchestrator queue (inside workflow)
    // 3: DependencyResolverActivities — onchain queue (inside workflow)
    // 4: TypescriptAlgorithmDispatcherActivities (inside workflow)
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
    } as never);

    const getSnapshot = vi.fn().mockResolvedValue({
      status: SnapshotStatus.queued,
      algorithmPresetFrozen: {
        key: 'custom_algorithm',
        version: '1.0.0',
        inputs: [
          { key: 'sub_ids', value: 'uploads/sub_ids.json' },
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
          key: 'custom_algorithm',
          version: '1.0.0',
          kind: 'combined',
          runtime: 'typescript',
          dependencies: [{ key: 'deepfunding-portal-api' }],
          inputs: [
            {
              key: 'sub_algorithms',
              type: 'sub_algorithm',
              sharedInputKeys: ['sub_ids'],
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
      outputs: { composite_score: 'snapshots/snapshot-1/custom_algorithm.csv' },
    });

    proxyActivities.mockImplementation(
      () =>
        ({
          getSnapshot,
          updateSnapshot,
          getAlgorithmDefinition,
          resolveDependency,
          runTypescriptAlgorithm,
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
    } as never);

    const getSnapshot = vi.fn().mockResolvedValue({
      status: SnapshotStatus.queued,
      algorithmPresetFrozen: {
        key: 'custom_algorithm',
        version: '1.0.0',
        inputs: [
          { key: 'sub_ids', value: 'uploads/sub_ids.json' },
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
          key: 'custom_algorithm',
          version: '1.0.0',
          kind: 'combined',
          runtime: 'typescript',
          inputs: [
            {
              key: 'sub_algorithms',
              type: 'sub_algorithm',
              sharedInputKeys: ['sub_ids'],
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
      outputs: { composite_score: 'snapshots/snapshot-1/custom_algorithm.csv' },
    });

    proxyActivities.mockImplementation(
      () =>
        ({
          getSnapshot,
          updateSnapshot,
          getAlgorithmDefinition,
          resolveDependency,
          runTypescriptAlgorithm,
        }) as never,
    );

    const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');

    await OrchestratorWorkflow({
      snapshotId: 'snapshot-1',
    });

    expect(getAlgorithmDefinition).toHaveBeenNthCalledWith(1, {
      key: 'custom_algorithm',
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
