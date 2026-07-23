import { fileURLToPath } from 'node:url';
import { ApplicationFailure, WorkflowFailedError, type WorkflowHandle } from '@temporalio/client';
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
import type {
  CheckEncryptionReadinessResult,
  SubmitCustomEncryptedScoresInput,
  SubmitCustomEncryptedScoresResult,
} from '../../../src/shared/types/index.js';
import { encryptedCustomScoreLifecycleWorkflow } from './support/encrypted-custom-score.workflows.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DEADLINE_MS = 24 * HOUR_MS;

// Time-skipping makes timers instant, but each poll still spends a few real
// milliseconds in activity and server round-trips.
const CLOCK_TOLERANCE_MS = 15_000;

const TIMESTAMP = '2026-07-22T10:00:00.000Z';

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
  observations: [{ scoreType: 'voting_engagement', observation: { method: 'observed_min_max', min: 0, max: 10 } }],
  timestamp: TIMESTAMP,
};

type WorkflowHistory = Awaited<ReturnType<WorkflowHandle['fetchHistory']>>;

function readinessResult(ready: boolean): CheckEncryptionReadinessResult {
  return {
    ready,
    counts: ready
      ? { complete: 3, potentiallyComplete: 0, incomplete: 1 }
      : { complete: 2, potentiallyComplete: 1, incomplete: 1 },
    scannedUsers: 4,
    pages: 1,
    cursorRestarts: 0,
    lastRequestId: 'req-poll',
  };
}

function submittedResult(): SubmitCustomEncryptedScoresResult {
  return {
    outcome: 'submitted',
    complete: 3,
    incomplete: 1,
    scannedUsers: 4,
    pages: 1,
    cursorRestarts: 0,
    submitted: 3,
    batches: 1,
    registeredKeys: 1,
    lastRequestId: 'req-final',
  };
}

function pendingResult(): SubmitCustomEncryptedScoresResult {
  return {
    outcome: 'pending_encryption',
    complete: 1,
    incomplete: 1,
    scannedUsers: 2,
    pages: 1,
    cursorRestarts: 0,
    lastRequestId: 'req-pending',
  };
}

/**
 * Timers only ever fire late, but each activity round-trip also spends a few
 * real milliseconds, so intervals measured across activities can land slightly
 * on either side of the ideal offset.
 */
function expectNear(actualMs: number, expectedMs: number): void {
  expect(Math.abs(actualMs - expectedMs)).toBeLessThan(CLOCK_TOLERANCE_MS);
}

describe('runEncryptedCustomScoreLifecycle (Temporal time-skipping environment)', () => {
  let testEnv: TestWorkflowEnvironment;
  let bundle: WorkflowBundleWithSourceMap;
  let regressionRunHistory: WorkflowHistory;
  let timedOutRunHistory: WorkflowHistory;

  beforeAll(async () => {
    Runtime.install({ logger: new DefaultLogger('WARN') });
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();
    bundle = await bundleWorkflowCode({
      workflowsPath: fileURLToPath(new URL('./support/encrypted-custom-score.workflows.ts', import.meta.url)),
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

  it('returns to readiness polling after a pending processing pass and reuses the fixed timestamp and observations', async () => {
    let polls = 0;
    const passes: SubmitCustomEncryptedScoresInput[] = [];
    const activities = {
      async checkEncryptionReadiness(): Promise<CheckEncryptionReadinessResult> {
        polls += 1;
        return readinessResult(true);
      },
      async submitCustomEncryptedScores(
        input: SubmitCustomEncryptedScoresInput,
      ): Promise<SubmitCustomEncryptedScoresResult> {
        passes.push(input);
        return passes.length === 1 ? pendingResult() : submittedResult();
      },
    };

    const outcome = await withWorker('tq-lifecycle-regression', activities, async () => {
      const handle = await testEnv.client.workflow.start(encryptedCustomScoreLifecycleWorkflow, {
        taskQueue: 'tq-lifecycle-regression',
        workflowId: 'lifecycle-regression',
        args: [WORKFLOW_INPUT as never],
      });
      const result = await handle.result();
      regressionRunHistory = await handle.fetchHistory();
      return result;
    });

    // Round 1 polls once (ready) and its pass regresses; round 2 polls again
    // and its pass submits. The returned readiness outcome is round 2's, and
    // its workflow-time offsets prove the poll schedule restarted at the
    // 5-minute delay after the regression.
    expect(polls).toBe(2);
    expect(passes).toHaveLength(2);
    expect(outcome.rounds).toBe(2);
    expect(outcome.readiness.pollCount).toBe(1);
    expect(outcome.readiness.polledAtOffsetsMs).toHaveLength(1);
    expectNear(outcome.readiness.polledAtOffsetsMs[0], 5 * MINUTE_MS);

    // Both passes carry the identical logical identity: same snapshot,
    // observations, and run timestamp — the DeepID idempotency key.
    expect(passes[1]).toEqual(passes[0]);
    expect(passes[0].timestamp).toBe(TIMESTAMP);
    expect(passes[0].observations).toEqual(WORKFLOW_INPUT.observations);

    expect(outcome.submission.outcome).toBe('submitted');
    expect(outcome.submission.submitted).toBe(3);
  }, 120_000);

  it('keeps the 24-hour deadline anchored at raw submission across pending regressions', async () => {
    let polls = 0;
    let passes = 0;
    const activities = {
      async checkEncryptionReadiness(): Promise<CheckEncryptionReadinessResult> {
        polls += 1;
        // Ready exactly once (round 1); afterwards encryption never finishes.
        return readinessResult(polls === 1);
      },
      async submitCustomEncryptedScores(): Promise<SubmitCustomEncryptedScoresResult> {
        passes += 1;
        return pendingResult();
      },
    };

    const failure = await withWorker('tq-lifecycle-deadline', activities, async () => {
      const handle = await testEnv.client.workflow.start(encryptedCustomScoreLifecycleWorkflow, {
        taskQueue: 'tq-lifecycle-deadline',
        workflowId: 'lifecycle-deadline',
        args: [WORKFLOW_INPUT as never],
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

    // Round 1 consumed one 5-minute poll before its pass regressed, so round
    // 2's polling window is 24h minus those 5 minutes. A deadline that
    // restarted per round would report a full 24h instead.
    const details = applicationFailure.details?.[0] as { elapsedMs: number };
    expectNear(details.elapsedMs, DEADLINE_MS - 5 * MINUTE_MS);
    expect(passes).toBe(1);
  }, 120_000);

  it('replays both recorded runs deterministically, so a worker restart preserves the lifecycle state machine', async () => {
    await expect(Worker.runReplayHistory({ workflowBundle: bundle }, regressionRunHistory)).resolves.toBeUndefined();
    await expect(Worker.runReplayHistory({ workflowBundle: bundle }, timedOutRunHistory)).resolves.toBeUndefined();
  }, 120_000);
});
