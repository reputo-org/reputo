import {
  API_SNAPSHOT_ACTIVITIES_TASK_QUEUE,
  type ApiSnapshotActivities,
  type RecordSnapshotPublicationInput,
  SNAPSHOT_NOT_FOUND_ERROR_TYPE,
  SnapshotPublicationStatus,
} from '@reputo/contracts';
import * as workflow from '@temporalio/workflow';
import {
  ACTIVITY_MAX_ATTEMPTS,
  ALGORITHM_EXECUTION_TIMEOUT,
  ALGORITHM_LIBRARY_TIMEOUT,
  COMMUNITY_DEPENDENCY_RESOLUTION_TIMEOUT,
  communityTaskQueue,
  DB_ACTIVITY_TIMEOUT,
  DEEP_ID_ENCRYPTED_SUBMISSION_TIMEOUT,
  DEEP_ID_POST_SCORES_HEARTBEAT_TIMEOUT,
  DEEP_ID_POST_SCORES_TIMEOUT,
  DEEP_ID_READINESS_CHECK_TIMEOUT,
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
  CommunityDependencyKey,
  CommunityFetchInput,
  DeepIdEncryptionReadinessActivities,
  DeepIdPostScoresActivities,
  DeepIdSubmitCustomScoresActivities,
  DeepIdSubmitEncryptedScoresActivities,
  DependencyKey,
  DependencyResolverActivities,
  OrchestratorWorkflowInput,
  ResolveDependencyResult,
  Snapshot,
  SyncTarget,
  TypescriptAlgorithmDispatcherActivities,
} from '../shared/types/index.js';
import { COMMUNITY_PLATFORM_BY_DEPENDENCY_KEY, isCommunityDependencyKey } from '../shared/types/index.js';
import { extractCommunityFetchInput } from '../shared/utils/community-fetch.utils.js';
import {
  buildCombinedChildAlgorithmPresets,
  getAlgorithmTaskQueueFromRuntime,
} from '../shared/utils/orchestrator-input.utils.js';
import { extractOnchainSyncTargets } from '../shared/utils/sync-targets.utils.js';
import { runEncryptedCustomScoreLifecycle } from './encrypted-custom-score.js';

const { getSnapshot, updateSnapshot, getCommunityConnection, recordSnapshotPublication } =
  workflow.proxyActivities<ApiSnapshotActivities>({
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

/** The preset of the first source declaring the dependency — its inputs configure the fetch. */
function findDependencyPreset(sources: DependencySource[], dependencyKey: DependencyKey): DependencySource['preset'] {
  for (const source of sources) {
    if ((source.definition.dependencies ?? []).some((dependency) => dependency.key === dependencyKey)) {
      return source.preset;
    }
  }
  return sources[0].preset;
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

/** The first dependency result that assembled a DID map (e.g. the `deep-id` fetch), if any. */
function pickGeneratedDidsKey(results: ResolveDependencyResult[]): string | undefined {
  for (const result of results) {
    if (result?.didsKey) {
      return result.didsKey;
    }
  }
  return undefined;
}

/**
 * Builds a community dependency's fetch input: the frozen preset supplies the
 * connection, resources, and window; the connection row (read through the API
 * activities queue — the workers have no application database) supplies the
 * platform-side community id the cohort's member lookup runs against.
 */
async function resolveCommunityFetch(
  dependencyKey: CommunityDependencyKey,
  preset: Parameters<typeof extractCommunityFetchInput>[0],
  windowEnd: Date,
): Promise<CommunityFetchInput> {
  const fetchInput = extractCommunityFetchInput(preset, windowEnd);
  const connection = await getCommunityConnection({ connectionId: fetchInput.connectionId });
  const platform = COMMUNITY_PLATFORM_BY_DEPENDENCY_KEY[dependencyKey];
  if (connection.platform !== platform) {
    throw new Error(
      `Preset connection "${connection.name}" is a ${connection.platform} connection; dependency "${dependencyKey}" needs ${platform}`,
    );
  }
  return { ...fetchInput, communityId: connection.externalId };
}

/** Point the algorithm's `dids` input at a dependency-assembled DID map (in-memory only). */
function applyDidsOverride(snapshot: Snapshot, didsKey: string): void {
  const inputs = snapshot.algorithmPresetFrozen.inputs;
  const existing = inputs.find((input) => input.key === 'dids');
  if (existing) {
    existing.value = didsKey;
  } else {
    inputs.push({ key: 'dids', value: didsKey });
  }
}

export async function OrchestratorWorkflow(input: OrchestratorWorkflowInput): Promise<void> {
  try {
    await runOrchestrator(input);
  } catch (error) {
    if (error instanceof workflow.TemporalFailure) {
      throw error;
    }
    // A non-Temporal error escaping workflow code fails only the workflow
    // task, which the server retries forever; convert it so the run fails.
    throw workflow.ApplicationFailure.fromError(error, { nonRetryable: true });
  }
}

async function runOrchestrator(input: OrchestratorWorkflowInput): Promise<void> {
  const { snapshotId } = input;
  const workflowInfo = workflow.workflowInfo();
  const orchestratorTaskQueue = workflowInfo.taskQueue;

  workflow.log.info('Starting OrchestratorWorkflow', {
    snapshotId,
    workflowId: workflowInfo.workflowId,
    runId: workflowInfo.runId,
  });

  const snapshot = await getSnapshot({ snapshotId });

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

  // One failure handler covers every phase after the running write —
  // definition lookups, dependency resolution, algorithm execution, DeepID
  // submissions — so no error or cancellation can strand the row in
  // `running`. Paths where no workflow code runs at all (run timeout,
  // terminate) are settled by the API-side snapshot reconciler instead.
  const run: SnapshotRunState = {};
  try {
    await runSnapshotPhases({ snapshotId, snapshot, workflowInfo, orchestratorTaskQueue, run });
  } catch (error) {
    if (isSnapshotNotFound(error)) {
      workflow.log.warn('Snapshot row is gone; skipping the terminal status write', { snapshotId });
      throw error;
    }

    const isCancelled = workflow.isCancellation(error);
    const status = isCancelled ? SnapshotStatus.cancelled : SnapshotStatus.failed;
    const message = isCancelled ? 'Workflow was cancelled' : (error as Error).message || 'Unknown error';

    workflow.log.error('Snapshot run failed', {
      snapshotId,
      cancelled: isCancelled,
      error: message,
    });

    await workflow.CancellationScope.nonCancellable(async () => {
      try {
        await updateSnapshot({
          snapshotId,
          status,
          temporal: {
            workflowId: workflowInfo.workflowId,
            runId: workflowInfo.runId,
            taskQueue: orchestratorTaskQueue,
            algorithmTaskQueue: run.algorithmTaskQueue,
          },
          error: { message },
        });
        workflow.log.info(`Snapshot marked as ${status}`, { snapshotId });
      } catch (updateError) {
        // Never mask the original failure; the reconciler settles the row.
        workflow.log.error('Failed to record the terminal snapshot status', {
          snapshotId,
          status,
          error: (updateError as Error).message,
        });
      }
    });

    throw error;
  }

  // Best-effort: post a non-custom snapshot's scores back to DeepID. This runs
  // only after a successful completion and never affects the snapshot status —
  // a posting failure is retried by Temporal, then logged and swallowed so it
  // can never fail the reputation run. Its outcome is recorded per algorithm
  // key in the publication ledger, so a failure stays visible instead of only
  // living in worker logs. Combined snapshots already submitted their native
  // child scores and final encrypted entries before completion.
  if (run.algorithmKind !== 'combined') {
    const { postSnapshotScores } = workflow.proxyActivities<DeepIdPostScoresActivities>({
      taskQueue: orchestratorTaskQueue,
      startToCloseTimeout: DEEP_ID_POST_SCORES_TIMEOUT,
      heartbeatTimeout: DEEP_ID_POST_SCORES_HEARTBEAT_TIMEOUT,
      retry: { maximumAttempts: ACTIVITY_MAX_ATTEMPTS },
    });

    const algorithmKey = snapshot.algorithmPresetFrozen.key;
    const recordPublication = async (record: Omit<RecordSnapshotPublicationInput, 'snapshotId' | 'algorithmKey'>) => {
      try {
        await recordSnapshotPublication({ snapshotId, algorithmKey, ...record });
      } catch (recordError) {
        workflow.log.error('Recording the publication status failed (non-fatal)', {
          snapshotId,
          error: (recordError as Error).message,
        });
      }
    };

    try {
      const completedSnapshot = await getSnapshot({ snapshotId });
      await recordPublication({ status: SnapshotPublicationStatus.pending });
      // One run-consistent timestamp (the workflow start) keys DeepID's
      // idempotent dedup, so a retried post can never duplicate scores.
      const postResult = await postSnapshotScores({
        snapshot: completedSnapshot,
        timestamp: workflowInfo.startTime.toISOString(),
      });
      workflow.log.info('DeepID score posting finished', { snapshotId, ...postResult });

      if (postResult.attempted) {
        const { attempted: _attempted, ...counts } = postResult;
        await recordPublication({ status: SnapshotPublicationStatus.sent, counts });
      } else {
        await recordPublication({
          status: SnapshotPublicationStatus.failed,
          error: 'The algorithm produced no postable score output',
        });
      }
    } catch (postError) {
      workflow.log.error('DeepID score posting failed (non-fatal)', {
        snapshotId,
        error: (postError as Error).message,
      });
      await recordPublication({
        status: SnapshotPublicationStatus.failed,
        error: (postError as Error).message,
      });
    }
  }
}

interface SnapshotRunState {
  algorithmTaskQueue?: string;
  algorithmKind?: string;
}

/** True when the error chain contains the non-retryable snapshot-deleted failure. */
function isSnapshotNotFound(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if (current instanceof workflow.ApplicationFailure && current.type === SNAPSHOT_NOT_FOUND_ERROR_TYPE) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

async function runSnapshotPhases(args: {
  snapshotId: string;
  snapshot: Snapshot;
  workflowInfo: workflow.WorkflowInfo;
  orchestratorTaskQueue: string;
  run: SnapshotRunState;
}): Promise<void> {
  const { snapshotId, snapshot, workflowInfo, orchestratorTaskQueue, run } = args;

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

  run.algorithmKind = algorithmDefinition.kind;
  const runtime = algorithmDefinition.runtime;
  const algorithmTaskQueue = getAlgorithmTaskQueueFromRuntime(runtime);
  run.algorithmTaskQueue = algorithmTaskQueue;

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

  const { resolveDependency: resolveCommunityDependency } = workflow.proxyActivities<DependencyResolverActivities>({
    taskQueue: communityTaskQueue,
    startToCloseTimeout: COMMUNITY_DEPENDENCY_RESOLUTION_TIMEOUT,
    heartbeatTimeout: HEARTBEAT_TIMEOUT,
    retry: { maximumAttempts: ACTIVITY_MAX_ATTEMPTS },
  });

  const typescriptAlgorithmActivities = workflow.proxyActivities<TypescriptAlgorithmDispatcherActivities>({
    taskQueue: algorithmTaskQueue,
    startToCloseTimeout: ALGORITHM_EXECUTION_TIMEOUT,
    heartbeatTimeout: HEARTBEAT_TIMEOUT,
    retry: { maximumAttempts: ACTIVITY_MAX_ATTEMPTS },
  });

  const { submitCustomRawScores } = workflow.proxyActivities<DeepIdSubmitCustomScoresActivities>({
    taskQueue: orchestratorTaskQueue,
    startToCloseTimeout: DEEP_ID_POST_SCORES_TIMEOUT,
    heartbeatTimeout: DEEP_ID_POST_SCORES_HEARTBEAT_TIMEOUT,
    retry: { maximumAttempts: ACTIVITY_MAX_ATTEMPTS },
  });

  const { checkEncryptionReadiness } = workflow.proxyActivities<DeepIdEncryptionReadinessActivities>({
    taskQueue: orchestratorTaskQueue,
    startToCloseTimeout: DEEP_ID_READINESS_CHECK_TIMEOUT,
    heartbeatTimeout: DEEP_ID_POST_SCORES_HEARTBEAT_TIMEOUT,
    retry: { maximumAttempts: ACTIVITY_MAX_ATTEMPTS },
  });

  const { submitCustomEncryptedScores } = workflow.proxyActivities<DeepIdSubmitEncryptedScoresActivities>({
    taskQueue: orchestratorTaskQueue,
    startToCloseTimeout: DEEP_ID_ENCRYPTED_SUBMISSION_TIMEOUT,
    heartbeatTimeout: DEEP_ID_POST_SCORES_HEARTBEAT_TIMEOUT,
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

      const dependencyResults = await Promise.all(
        dependencyKeys.map(async (dependencyKey) => {
          if (dependencyKey === 'onchain-data') {
            return resolveOnchainDataDependency({
              dependencyKey,
              snapshotId,
              syncTargets,
            });
          }
          if (isCommunityDependencyKey(dependencyKey)) {
            return resolveCommunityDependency({
              dependencyKey,
              snapshotId,
              communityFetch: await resolveCommunityFetch(
                dependencyKey,
                findDependencyPreset(dependencySources, dependencyKey),
                workflowInfo.startTime,
              ),
            });
          }
          return resolveOrchestratorDependency({
            dependencyKey,
            snapshotId,
          });
        }),
      );

      const generatedDidsKey = pickGeneratedDidsKey(dependencyResults);
      if (generatedDidsKey) {
        applyDidsOverride(snapshot, generatedDidsKey);
        workflow.log.info('Using DeepID-assembled DID input', { snapshotId, didsKey: generatedDidsKey });
      }

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

    const dependencyResults = await Promise.all(
      algorithmDefinition.dependencies.map(async (dependency) => {
        const dependencyKey = dependency.key as DependencyKey;
        if (dependencyKey === 'onchain-data') {
          return resolveOnchainDataDependency({
            dependencyKey,
            snapshotId,
            syncTargets,
          });
        }
        if (isCommunityDependencyKey(dependencyKey)) {
          return resolveCommunityDependency({
            dependencyKey,
            snapshotId,
            communityFetch: await resolveCommunityFetch(
              dependencyKey,
              snapshot.algorithmPresetFrozen,
              workflowInfo.startTime,
            ),
          });
        }
        return resolveOrchestratorDependency({
          dependencyKey,
          snapshotId,
        });
      }),
    );

    const generatedDidsKey = pickGeneratedDidsKey(dependencyResults);
    if (generatedDidsKey) {
      applyDidsOverride(snapshot, generatedDidsKey);
      workflow.log.info('Using DeepID-assembled DID input', { snapshotId, didsKey: generatedDidsKey });
    }

    workflow.log.info('All dependencies resolved', {
      snapshotId,
      algorithmKey,
    });
  }

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

  if (algorithmDefinition.kind === 'combined') {
    // Persist the native child artifacts while the snapshot stays running so
    // they survive the long encryption window and a workflow retry. The raw
    // submission still receives result.outputs directly — never a refetch.
    await updateSnapshot({
      snapshotId,
      outputs: result.outputs as Record<string, string>,
      temporal: {
        workflowId: workflowInfo.workflowId,
        runId: workflowInfo.runId,
        taskQueue: orchestratorTaskQueue,
        algorithmTaskQueue,
      },
    });

    // The custom path submits every child's native raw scores before the
    // snapshot completes, and a submission failure fails the run. One
    // run-consistent timestamp (the workflow start) keys DeepID's idempotent
    // dedup, so activity retries and later run stages reuse the same value.
    const runTimestamp = workflowInfo.startTime.toISOString();
    const submission = await submitCustomRawScores({
      snapshotId,
      algorithmPresetFrozen: snapshot.algorithmPresetFrozen,
      outputs: result.outputs,
      timestamp: runTimestamp,
    });

    workflow.log.info('Submitted custom raw child scores to DeepID', {
      snapshotId,
      timestamp: runTimestamp,
      children: submission.children.map(({ scoreType, observation, posted, ok, dropped, rejected }) => ({
        scoreType,
        observation,
        posted,
        ok,
        dropped,
        rejected,
      })),
    });

    // Nothing encrypted may be evaluated or submitted while a selected
    // child score is still pending_encryption; the snapshot completes only
    // after DeepID accepts every complete user's final encrypted entry.
    const lifecycle = await runEncryptedCustomScoreLifecycle({
      snapshotId,
      algorithmPresetFrozen: snapshot.algorithmPresetFrozen,
      observations: submission.children.map(({ scoreType, observation }) => ({ scoreType, observation })),
      timestamp: runTimestamp,
      checkEncryptionReadiness,
      submitCustomEncryptedScores,
    });

    workflow.log.info('DeepID accepted every final encrypted custom score', {
      snapshotId,
      rounds: lifecycle.rounds,
      complete: lifecycle.submission.complete,
      incomplete: lifecycle.submission.incomplete,
      submitted: lifecycle.submission.submitted,
      batches: lifecycle.submission.batches,
      pages: lifecycle.submission.pages,
      cursorRestarts: lifecycle.submission.cursorRestarts,
      registeredKeys: lifecycle.submission.registeredKeys,
      lastRequestId: lifecycle.submission.lastRequestId,
    });
  }

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
}
