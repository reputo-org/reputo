import { API_SNAPSHOT_ACTIVITIES_TASK_QUEUE, type ApiSnapshotActivities } from '@reputo/contracts';
import * as workflow from '@temporalio/workflow';
import {
  ACTIVITY_MAX_ATTEMPTS,
  ALGORITHM_EXECUTION_TIMEOUT,
  ALGORITHM_LIBRARY_TIMEOUT,
  DB_ACTIVITY_TIMEOUT,
  DEPENDENCY_RESOLUTION_TIMEOUT,
  HEARTBEAT_TIMEOUT,
  ONCHAIN_DATA_DEPENDENCY_RESOLUTION_TIMEOUT,
  onchainDataTaskQueue,
  SnapshotStatus,
} from '../shared/constants/index.js';
import { UnsupportedAlgorithmError } from '../shared/errors/index.js';
import type {
  AlgorithmLibraryActivities,
  AlgorithmResult,
  DependencyKey,
  DependencyResolverActivities,
  OrchestratorWorkflowInput,
  SyncTarget,
  TypescriptAlgorithmDispatcherActivities,
} from '../shared/types/index.js';
import {
  buildCombinedChildAlgorithmPresets,
  getAlgorithmTaskQueueFromRuntime,
} from '../shared/utils/orchestrator-input.utils.js';
import { extractOnchainSyncTargets } from '../shared/utils/sync-targets.utils.js';

const { getSnapshot, updateSnapshot } = workflow.proxyActivities<ApiSnapshotActivities>({
  taskQueue: API_SNAPSHOT_ACTIVITIES_TASK_QUEUE,
  startToCloseTimeout: DB_ACTIVITY_TIMEOUT,
  retry: { maximumAttempts: ACTIVITY_MAX_ATTEMPTS },
});

const { getAlgorithmDefinition } = workflow.proxyActivities<AlgorithmLibraryActivities>({
  startToCloseTimeout: ALGORITHM_LIBRARY_TIMEOUT,
  retry: { maximumAttempts: ACTIVITY_MAX_ATTEMPTS },
});

interface OrchestratorAlgorithmDefinition {
  key: string;
  version: string;
  runtime: string;
  kind?: string;
  inputs?: Array<{
    key: string;
    type?: string;
    sharedInputKeys?: string[];
    uiHint?: {
      resourceCatalog?: {
        chains: Array<{
          key: string;
          resources: Array<{
            key: string;
            kind: string;
            identifier: string;
            tokenIdentifier: string;
            parentResourceKey?: string;
          }>;
        }>;
      };
    };
  }>;
  dependencies?: Array<{ key: string }>;
}

interface DependencySource {
  definition: OrchestratorAlgorithmDefinition;
  preset: Parameters<typeof buildCombinedChildAlgorithmPresets>[0];
}

function collectDependencyKeys(sources: DependencySource[]): DependencyKey[] {
  const dependencyKeys: DependencyKey[] = [];
  const seen = new Set<DependencyKey>();

  for (const source of sources) {
    for (const dependency of source.definition.dependencies ?? []) {
      const dependencyKey = dependency.key as DependencyKey;
      if (seen.has(dependencyKey)) {
        continue;
      }

      seen.add(dependencyKey);
      dependencyKeys.push(dependencyKey);
    }
  }

  return dependencyKeys;
}

function collectOnchainSyncTargets(sources: DependencySource[]): SyncTarget[] {
  const syncTargets: SyncTarget[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    const hasOnchainDependency = (source.definition.dependencies ?? []).some(
      (dependency) => dependency.key === 'onchain-data',
    );
    if (!hasOnchainDependency) {
      continue;
    }

    for (const target of extractOnchainSyncTargets(source.preset, source.definition)) {
      const dedupeKey = `${target.chain}:${target.identifier.toLowerCase()}`;
      if (seen.has(dedupeKey)) {
        continue;
      }

      seen.add(dedupeKey);
      syncTargets.push(target);
    }
  }

  return syncTargets;
}

export async function OrchestratorWorkflow(input: OrchestratorWorkflowInput): Promise<void> {
  const { snapshotId } = input;
  const workflowInfo = workflow.workflowInfo();
  const orchestratorTaskQueue = workflowInfo.taskQueue;

  workflow.log.info('Starting OrchestratorWorkflow', {
    snapshotId,
    workflowId: workflowInfo.workflowId,
    runId: workflowInfo.runId,
  });

  const getSnapshotResult = await getSnapshot({ snapshotId });
  if (!getSnapshotResult.ok) {
    throw new Error(getSnapshotResult.error.message);
  }
  const snapshot = getSnapshotResult.snapshot;

  workflow.log.info('Snapshot fetched', {
    snapshotId,
    status: snapshot.status,
    algorithmKey: snapshot.algorithmPresetFrozen?.key,
    algorithmVersion: snapshot.algorithmPresetFrozen?.version,
  });

  if (snapshot.status === SnapshotStatus.completed) {
    workflow.log.warn('Snapshot already completed, skipping execution', {
      snapshotId,
      status: snapshot.status,
    });
    return;
  }

  await updateSnapshot({
    snapshotId,
    status: SnapshotStatus.running,
    temporal: {
      workflowId: workflowInfo.workflowId,
      runId: workflowInfo.runId,
      taskQueue: orchestratorTaskQueue,
    },
  });
  workflow.log.info('Snapshot marked as running', { snapshotId });

  const algorithmKey = snapshot.algorithmPresetFrozen.key;
  const algorithmVersion = snapshot.algorithmPresetFrozen.version;

  const { algorithmDefinition: rootAlgorithmDefinition } = await getAlgorithmDefinition({
    key: algorithmKey,
    version: algorithmVersion,
  });
  const algorithmDefinition = rootAlgorithmDefinition as OrchestratorAlgorithmDefinition;

  workflow.log.info('Algorithm definition loaded', {
    snapshotId,
    algorithmKey: algorithmDefinition.key,
    algorithmVersion: algorithmDefinition.version,
  });

  const runtime = algorithmDefinition.runtime;
  const algorithmTaskQueue = getAlgorithmTaskQueueFromRuntime(runtime);

  const { resolveDependency: resolveOrchestratorDependency } = workflow.proxyActivities<DependencyResolverActivities>({
    taskQueue: orchestratorTaskQueue,
    startToCloseTimeout: DEPENDENCY_RESOLUTION_TIMEOUT,
    heartbeatTimeout: HEARTBEAT_TIMEOUT,
    retry: { maximumAttempts: ACTIVITY_MAX_ATTEMPTS },
  });

  const { resolveDependency: resolveOnchainDataDependency } = workflow.proxyActivities<DependencyResolverActivities>({
    taskQueue: onchainDataTaskQueue,
    startToCloseTimeout: ONCHAIN_DATA_DEPENDENCY_RESOLUTION_TIMEOUT,
    retry: { maximumAttempts: ACTIVITY_MAX_ATTEMPTS },
  });

  const typescriptAlgorithmActivities = workflow.proxyActivities<TypescriptAlgorithmDispatcherActivities>({
    taskQueue: algorithmTaskQueue,
    startToCloseTimeout: ALGORITHM_EXECUTION_TIMEOUT,
    heartbeatTimeout: HEARTBEAT_TIMEOUT,
    retry: { maximumAttempts: ACTIVITY_MAX_ATTEMPTS },
  });

  if (algorithmDefinition.kind === 'combined') {
    const childPresets = buildCombinedChildAlgorithmPresets(snapshot.algorithmPresetFrozen, algorithmDefinition);
    const childDependencySources = await Promise.all(
      childPresets.map(async (childPreset) => {
        const { algorithmDefinition: childAlgorithmDefinition } = await getAlgorithmDefinition({
          key: childPreset.key,
          version: childPreset.version,
        });

        return {
          definition: childAlgorithmDefinition as OrchestratorAlgorithmDefinition,
          preset: childPreset,
        };
      }),
    );

    const dependencySources: DependencySource[] = [
      {
        definition: algorithmDefinition,
        preset: snapshot.algorithmPresetFrozen,
      },
      ...childDependencySources,
    ];
    const dependencyKeys = collectDependencyKeys(dependencySources);

    if (dependencyKeys.length > 0) {
      workflow.log.info('Resolving combined algorithm dependencies', {
        snapshotId,
        algorithmKey,
        dependencies: dependencyKeys,
        childAlgorithms: childDependencySources.map(({ definition }) => `${definition.key}@${definition.version}`),
      });

      const syncTargets = collectOnchainSyncTargets(dependencySources);

      await Promise.all(
        dependencyKeys.map(async (dependencyKey) => {
          if (dependencyKey === 'onchain-data') {
            await resolveOnchainDataDependency({
              dependencyKey,
              snapshotId,
              syncTargets,
            });
          } else {
            await resolveOrchestratorDependency({
              dependencyKey,
              snapshotId,
            });
          }
        }),
      );

      workflow.log.info('All combined algorithm dependencies resolved', {
        snapshotId,
        algorithmKey,
      });
    }
  } else if (algorithmDefinition.dependencies && algorithmDefinition.dependencies.length > 0) {
    workflow.log.info('Resolving algorithm dependencies', {
      snapshotId,
      dependencies: algorithmDefinition.dependencies.map((d) => d.key),
    });

    const syncTargets: SyncTarget[] = extractOnchainSyncTargets(
      snapshot.algorithmPresetFrozen,
      algorithmDefinition as Parameters<typeof extractOnchainSyncTargets>[1],
    );

    await Promise.all(
      algorithmDefinition.dependencies.map(async (dependency) => {
        const dependencyKey = dependency.key as DependencyKey;
        if (dependencyKey === 'onchain-data') {
          await resolveOnchainDataDependency({
            dependencyKey,
            snapshotId,
            syncTargets,
          });
        } else {
          await resolveOrchestratorDependency({
            dependencyKey,
            snapshotId,
          });
        }
      }),
    );

    workflow.log.info('All dependencies resolved', {
      snapshotId,
      algorithmKey,
    });
  }

  try {
    workflow.log.info('Executing algorithm activity (on-chain PostgreSQL may be used for transfer data)', {
      algorithmKey,
      algorithmTaskQueue,
      snapshotId,
    });

    let result: AlgorithmResult;
    if (runtime === 'typescript') {
      result = await typescriptAlgorithmActivities.runTypescriptAlgorithm(snapshot);
    } else {
      throw new UnsupportedAlgorithmError(algorithmKey);
    }

    workflow.log.info('Algorithm execution completed successfully', {
      snapshotId,
      algorithmKey,
      outputKeys: Object.keys(result.outputs),
    });

    await updateSnapshot({
      snapshotId,
      status: SnapshotStatus.completed,
      outputs: result.outputs as Record<string, string>,
      temporal: {
        workflowId: workflowInfo.workflowId,
        runId: workflowInfo.runId,
        taskQueue: orchestratorTaskQueue,
        algorithmTaskQueue,
      },
    });

    workflow.log.info('Snapshot marked as completed', { snapshotId });
  } catch (error) {
    const isCancelled = workflow.isCancellation(error);
    const status = isCancelled ? SnapshotStatus.cancelled : SnapshotStatus.failed;
    const message = isCancelled ? 'Workflow was cancelled' : (error as Error).message || 'Unknown error';

    workflow.log.error('Algorithm execution failed', {
      snapshotId,
      cancelled: isCancelled,
      error: message,
    });

    await workflow.CancellationScope.nonCancellable(async () => {
      await updateSnapshot({
        snapshotId,
        status,
        temporal: {
          workflowId: workflowInfo.workflowId,
          runId: workflowInfo.runId,
          taskQueue: orchestratorTaskQueue,
          algorithmTaskQueue,
        },
        error: { message },
      });
    });

    workflow.log.info(`Snapshot marked as ${status}`, { snapshotId });
    throw error;
  }
}
