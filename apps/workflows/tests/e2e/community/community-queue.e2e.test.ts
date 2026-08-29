import { fileURLToPath } from 'node:url';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import {
  bundleWorkflowCode,
  DefaultLogger,
  Runtime,
  Worker,
  type WorkflowBundleWithSourceMap,
} from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { COMMUNITY_WORKER_MAX_CONCURRENT_ACTIVITIES, communityTaskQueue } from '../../../src/shared/constants/index.js';

const WORKFLOW_TASK_QUEUE = 'tq-community-queue-probe';

describe('community task queue serialization (Temporal time-skipping environment)', () => {
  let testEnv: TestWorkflowEnvironment;
  let bundle: WorkflowBundleWithSourceMap;

  beforeAll(async () => {
    vi.useRealTimers();
    try {
      Runtime.install({ logger: new DefaultLogger('WARN') });
    } catch {
      // Another suite in this fork already installed the runtime.
    }
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
    bundle = await bundleWorkflowCode({
      workflowsPath: fileURLToPath(new URL('./support/community-queue.workflows.ts', import.meta.url)),
    });
  }, 240_000);

  afterAll(async () => {
    await testEnv?.teardown();
  });

  it('runs two queued community fetches one at a time, in arrival order', async () => {
    const runs: Array<{ label: string; startedAt: number; endedAt: number }> = [];
    let active = 0;
    let maxActive = 0;
    let markFirstRunning = () => {};
    const firstRunning = new Promise<void>((resolve) => {
      markFirstRunning = resolve;
    });

    const communityWorker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: communityTaskQueue,
      maxConcurrentActivityTaskExecutions: COMMUNITY_WORKER_MAX_CONCURRENT_ACTIVITIES,
      activities: {
        probeCommunityFetch: async ({ label }: { label: string }) => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          if (label === 'first') {
            markFirstRunning();
          }
          const startedAt = Date.now();
          await new Promise((resolve) => setTimeout(resolve, 250));
          active -= 1;
          runs.push({ label, startedAt, endedAt: Date.now() });
        },
      },
    });
    const workflowWorker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: WORKFLOW_TASK_QUEUE,
      workflowBundle: bundle,
    });

    await workflowWorker.runUntil(
      communityWorker.runUntil(async () => {
        const first = await testEnv.client.workflow.start('CommunityQueueProbeWorkflow', {
          taskQueue: WORKFLOW_TASK_QUEUE,
          workflowId: 'community-probe-first',
          args: [{ label: 'first' }],
        });
        // The second snapshot arrives while the first fetch occupies the
        // single slot, so it must queue behind it.
        await firstRunning;
        const second = await testEnv.client.workflow.start('CommunityQueueProbeWorkflow', {
          taskQueue: WORKFLOW_TASK_QUEUE,
          workflowId: 'community-probe-second',
          args: [{ label: 'second' }],
        });
        await first.result();
        await second.result();
      }),
    );

    expect(maxActive).toBe(1);
    expect(runs.map((run) => run.label)).toEqual(['first', 'second']);
    expect(runs[1].startedAt).toBeGreaterThanOrEqual(runs[0].endedAt);
  }, 120_000);
});
