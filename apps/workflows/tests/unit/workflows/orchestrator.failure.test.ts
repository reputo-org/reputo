import { fileURLToPath } from 'node:url';
import { API_SNAPSHOT_ACTIVITIES_TASK_QUEUE } from '@reputo/contracts';
import { ApplicationFailure, WorkflowFailedError } from '@temporalio/client';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import {
  bundleWorkflowCode,
  DefaultLogger,
  Runtime,
  Worker,
  type WorkflowBundleWithSourceMap,
} from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SnapshotStatus } from '../../../src/shared/constants/index.js';

const TASK_QUEUE = 'tq-orchestrator-failure';

describe('OrchestratorWorkflow failure conversion (Temporal time-skipping environment)', () => {
  let testEnv: TestWorkflowEnvironment;
  let bundle: WorkflowBundleWithSourceMap;

  beforeAll(async () => {
    Runtime.install({ logger: new DefaultLogger('WARN') });
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
    bundle = await bundleWorkflowCode({
      workflowsPath: fileURLToPath(new URL('../../../src/workflows/orchestrator.workflow.ts', import.meta.url)),
      ignoreModules: ['fs', 'path', 'os', 'crypto'],
    });
  }, 240_000);

  afterAll(async () => {
    await testEnv?.teardown();
  });

  it('fails the run instead of retrying the workflow task when workflow code throws a plain error', async () => {
    const snapshotUpdates: Array<Record<string, unknown>> = [];

    const orchestratorWorker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowBundle: bundle,
      activities: {
        // `python` resolves a task queue but has no executable branch, so the
        // workflow itself throws UnsupportedAlgorithmError (a plain Error).
        getAlgorithmDefinition: async () => ({
          algorithmDefinition: {
            key: 'algo-key',
            version: '1.0.0',
            runtime: 'python',
            inputs: [],
            dependencies: [],
          },
        }),
      },
    });
    const snapshotWorker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: API_SNAPSHOT_ACTIVITIES_TASK_QUEUE,
      activities: {
        getSnapshot: async () => ({
          status: SnapshotStatus.queued,
          algorithmPresetFrozen: { key: 'algo-key', version: '1.0.0', inputs: [] },
        }),
        updateSnapshot: async (update: Record<string, unknown>) => {
          snapshotUpdates.push(update);
        },
      },
    });

    const failure = await snapshotWorker.runUntil(
      orchestratorWorker.runUntil(
        testEnv.client.workflow
          .execute('OrchestratorWorkflow', {
            taskQueue: TASK_QUEUE,
            workflowId: 'orchestrator-unsupported-runtime',
            args: [{ snapshotId: 'snap-unsupported' }],
            // Without the plain-error conversion this run would spin in
            // workflow-task retries; the short run timeout bounds the test.
            workflowRunTimeout: '1 minute',
          })
          .then(
            () => undefined,
            (thrown) => thrown as Error,
          ),
      ),
    );

    expect(failure).toBeInstanceOf(WorkflowFailedError);
    const cause = (failure as WorkflowFailedError).cause;
    expect(cause).toBeInstanceOf(ApplicationFailure);

    const applicationFailure = cause as ApplicationFailure;
    expect(applicationFailure.type).toBe('UnsupportedAlgorithmError');
    expect(applicationFailure.nonRetryable).toBe(true);
    expect(applicationFailure.message).toBe('Unsupported algorithm: algo-key');

    expect(snapshotUpdates.map((update) => update.status)).toEqual([SnapshotStatus.running, SnapshotStatus.failed]);
    expect(snapshotUpdates[1]).toMatchObject({ error: { message: 'Unsupported algorithm: algo-key' } });
  }, 120_000);
});
