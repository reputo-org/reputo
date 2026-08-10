import { fileURLToPath } from 'node:url';
import { ApplicationFailure, CancelledFailure, WorkflowFailedError, type WorkflowHandle } from '@temporalio/client';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import {
  bundleWorkflowCode,
  DefaultLogger,
  Runtime,
  Worker,
  type WorkflowBundleWithSourceMap,
} from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEEP_ID_ENCRYPTION_TIMEOUT_ERROR_TYPE } from '../../../src/shared/errors/index.js';
import type { CheckEncryptionReadinessResult } from '../../../src/shared/types/index.js';
import { encryptionReadinessPollWorkflow } from './support/encryption-readiness.workflows.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DEADLINE_MS = 24 * HOUR_MS;

// Delays 5m/15m/60m then hourly under a 24h deadline: polls land at 5m, 20m,
// 80m, 140m, ..., 1400m, plus one final clamped poll exactly at 1440m.
const DEADLINE_POLL_COUNT = 26;

// Time-skipping makes timers instant, but each poll still spends a few real
// milliseconds in activity and server round-trips.
const CLOCK_TOLERANCE_MS = 15_000;

const WORKFLOW_INPUT = {
  snapshotId: 'snap-1',
  algorithmPresetFrozen: {
    key: 'custom_score',
    version: '1.0.0',
    inputs: [
      {
        key: 'sub_algorithms',
        value: [{ algorithm_key: 'voting_engagement', algorithm_version: '1.0.0', weight: 1, inputs: [] }],
      },
    ],
  },
};

type WorkflowHistory = Awaited<ReturnType<WorkflowHandle['fetchHistory']>>;

function passResult(poll: number, ready: boolean): CheckEncryptionReadinessResult {
  return {
    ready,
    counts: ready
      ? { complete: 6, potentiallyComplete: 0, incomplete: 1 }
      : { complete: 2, potentiallyComplete: 3, incomplete: 1 },
    scannedUsers: 7,
    pages: 2,
    cursorRestarts: 0,
    lastRequestId: `req-${poll}`,
  };
}

/** A readiness stub that reports not-ready until `readyAtPoll` (never, when 0). */
function readinessStub(readyAtPoll: number) {
  const polls: number[] = [];
  return {
    polls,
    activities: {
      async checkEncryptionReadiness(): Promise<CheckEncryptionReadinessResult> {
        polls.push(Date.now());
        return passResult(polls.length, readyAtPoll > 0 && polls.length >= readyAtPoll);
      },
    },
  };
}

function expectNear(actualMs: number, expectedMs: number): void {
  expect(actualMs).toBeGreaterThanOrEqual(expectedMs);
  expect(actualMs).toBeLessThan(expectedMs + CLOCK_TOLERANCE_MS);
}

describe('pollForEncryptionReadiness (Temporal time-skipping environment)', () => {
  let testEnv: TestWorkflowEnvironment;
  let bundle: WorkflowBundleWithSourceMap;
  let readyRunHistory: WorkflowHistory;
  let timedOutRunHistory: WorkflowHistory;

  beforeAll(async () => {
    Runtime.install({ logger: new DefaultLogger('WARN') });
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
    bundle = await bundleWorkflowCode({
      workflowsPath: fileURLToPath(new URL('./support/encryption-readiness.workflows.ts', import.meta.url)),
    });
  }, 240_000);

  afterAll(async () => {
    await testEnv?.teardown();
  });

  async function withWorker<T>(
    taskQueue: string,
    activities: Record<string, unknown>,
    run: () => Promise<T>,
  ): Promise<T> {
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowBundle: bundle,
      activities,
    });
    return worker.runUntil(run());
  }

  it('polls 1 minute after submission, then 15 minutes, then 60, then hourly, and resolves on the ready pass', async () => {
    const { polls, activities } = readinessStub(5);

    const outcome = await withWorker('tq-readiness-schedule', activities, async () => {
      const handle = await testEnv.client.workflow.start(encryptionReadinessPollWorkflow, {
        taskQueue: 'tq-readiness-schedule',
        workflowId: 'readiness-schedule',
        args: [WORKFLOW_INPUT],
      });
      const result = await handle.result();
      readyRunHistory = await handle.fetchHistory();
      return result;
    });

    expect(polls).toHaveLength(5);
    expect(outcome.pollCount).toBe(5);
    expect(outcome.polledAtOffsetsMs).toHaveLength(5);

    const [first, second, third, fourth, fifth] = outcome.polledAtOffsetsMs;
    expectNear(first, MINUTE_MS);
    expectNear(second, 16 * MINUTE_MS);
    expectNear(third, 76 * MINUTE_MS);
    expectNear(fourth, 136 * MINUTE_MS);
    expectNear(fifth, 196 * MINUTE_MS);
    expectNear(outcome.elapsedMs, 196 * MINUTE_MS);

    expect(outcome.counts).toEqual({ complete: 6, potentiallyComplete: 0, incomplete: 1 });
    expect(outcome.lastRequestId).toBe('req-5');
  }, 120_000);

  it('fails with DEEPID_ENCRYPTION_TIMEOUT at the 24-hour deadline, with a final poll clamped onto the deadline', async () => {
    const { polls, activities } = readinessStub(0);

    const failure = await withWorker('tq-readiness-deadline', activities, async () => {
      const handle = await testEnv.client.workflow.start(encryptionReadinessPollWorkflow, {
        taskQueue: 'tq-readiness-deadline',
        workflowId: 'readiness-deadline',
        args: [WORKFLOW_INPUT],
      });
      const error = await handle.result().then(
        () => undefined,
        (thrown) => thrown as Error,
      );
      timedOutRunHistory = await handle.fetchHistory();
      return error;
    });

    expect(failure).toBeInstanceOf(WorkflowFailedError);
    const cause = (failure as WorkflowFailedError).cause;
    expect(cause).toBeInstanceOf(ApplicationFailure);

    const applicationFailure = cause as ApplicationFailure;
    expect(applicationFailure.type).toBe(DEEP_ID_ENCRYPTION_TIMEOUT_ERROR_TYPE);
    expect(applicationFailure.nonRetryable).toBe(true);
    expect(applicationFailure.message).toContain('DEEPID_ENCRYPTION_TIMEOUT');
    expect(applicationFailure.message).toContain('complete=2');
    expect(applicationFailure.message).toContain('potentiallyComplete=3');
    expect(applicationFailure.message).toContain('incomplete=1');
    expect(applicationFailure.message).toContain(`polls=${DEADLINE_POLL_COUNT}`);
    expect(applicationFailure.message).toContain(`lastRequestId=req-${DEADLINE_POLL_COUNT}`);

    const details = applicationFailure.details?.[0] as {
      pollCount: number;
      elapsedMs: number;
      counts: Record<string, number>;
    };
    expect(details.pollCount).toBe(DEADLINE_POLL_COUNT);
    expectNear(details.elapsedMs, DEADLINE_MS);
    expect(details.counts).toEqual({ complete: 2, potentiallyComplete: 3, incomplete: 1 });

    expect(polls).toHaveLength(DEADLINE_POLL_COUNT);
  }, 120_000);

  it('stops all future polling when the workflow is cancelled during a wait', async () => {
    let releaseFirstPoll!: () => void;
    const firstPollHappened = new Promise<void>((resolve) => {
      releaseFirstPoll = resolve;
    });
    const polls: number[] = [];
    const activities = {
      async checkEncryptionReadiness(): Promise<CheckEncryptionReadinessResult> {
        polls.push(Date.now());
        releaseFirstPoll();
        return passResult(polls.length, false);
      },
    };

    await withWorker('tq-readiness-cancel', activities, async () => {
      const handle = await testEnv.client.workflow.start(encryptionReadinessPollWorkflow, {
        taskQueue: 'tq-readiness-cancel',
        workflowId: 'readiness-cancel',
        args: [WORKFLOW_INPUT],
      });
      const resultPromise = handle.result().then(
        () => undefined,
        (thrown) => thrown as Error,
      );

      await firstPollHappened;
      await handle.cancel();
      const failure = await resultPromise;

      expect(failure).toBeInstanceOf(WorkflowFailedError);
      expect((failure as WorkflowFailedError).cause).toBeInstanceOf(CancelledFailure);

      const pollsWhenCancelled = polls.length;
      expect(polls.length).toBe(pollsWhenCancelled);
    });
  }, 120_000);

  it('replays both recorded runs deterministically, so a worker restart preserves the schedule and deadline', async () => {
    await expect(Worker.runReplayHistory({ workflowBundle: bundle }, readyRunHistory)).resolves.toBeUndefined();
    await expect(Worker.runReplayHistory({ workflowBundle: bundle }, timedOutRunHistory)).resolves.toBeUndefined();
  }, 120_000);
});
