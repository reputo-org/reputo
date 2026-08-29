import { describe, expect, it, vi } from 'vitest';
import { SnapshotStatus } from '../../../src/shared/constants/index.js';

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

const START_TIME = new Date('2026-08-29T10:30:00.000Z');

async function runWorkflow(handlers: {
  postSnapshotScores: ReturnType<typeof vi.fn>;
  recordSnapshotPublication: ReturnType<typeof vi.fn>;
}) {
  vi.resetModules();

  const temporalWorkflow = await import('@temporalio/workflow');
  vi.mocked(temporalWorkflow.workflowInfo).mockReturnValue({
    workflowId: 'wf-1',
    runId: 'run-1',
    taskQueue: 'orchestrator-q',
    startTime: START_TIME,
  } as never);

  const getSnapshot = vi.fn().mockResolvedValue({
    id: 'snapshot-1',
    status: SnapshotStatus.queued,
    completedAt: '2026-08-29T11:00:00.000Z',
    algorithmPresetFrozen: { key: 'discord_engagement', version: '1.0.0', inputs: [] },
    outputs: { discord_engagement: 'snapshots/snapshot-1/discord_engagement.csv' },
  });
  vi.mocked(temporalWorkflow.proxyActivities).mockImplementation(
    () =>
      ({
        getSnapshot,
        updateSnapshot: vi.fn().mockResolvedValue(undefined),
        getAlgorithmDefinition: vi.fn().mockResolvedValue({
          algorithmDefinition: { key: 'discord_engagement', version: '1.0.0', runtime: 'typescript' },
        }),
        resolveDependency: vi.fn().mockResolvedValue(undefined),
        runTypescriptAlgorithm: vi.fn().mockResolvedValue({
          outputs: { discord_engagement: 'snapshots/snapshot-1/discord_engagement.csv' },
        }),
        ...handlers,
      }) as never,
  );

  const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');
  await OrchestratorWorkflow({ snapshotId: 'snapshot-1' });
}

describe('OrchestratorWorkflow publication ledger', () => {
  it('records pending, posts with the run-consistent timestamp, then records sent with the counts', async () => {
    const postSnapshotScores = vi
      .fn()
      .mockResolvedValue({ attempted: true, posted: 3, ok: 2, failed: 0, dropped: 1, skipped: 0 });
    const recordSnapshotPublication = vi.fn().mockResolvedValue(undefined);

    await runWorkflow({ postSnapshotScores, recordSnapshotPublication });

    expect(postSnapshotScores).toHaveBeenCalledWith({
      snapshot: expect.objectContaining({ id: 'snapshot-1' }),
      timestamp: START_TIME.toISOString(),
    });
    expect(recordSnapshotPublication.mock.calls.map(([input]) => input)).toEqual([
      { snapshotId: 'snapshot-1', algorithmKey: 'discord_engagement', status: 'pending' },
      {
        snapshotId: 'snapshot-1',
        algorithmKey: 'discord_engagement',
        status: 'sent',
        counts: { posted: 3, ok: 2, failed: 0, dropped: 1, skipped: 0 },
      },
    ]);
  });

  it('records a failed publication when the post exhausts its retries — visibly, never silently', async () => {
    const postSnapshotScores = vi.fn().mockRejectedValue(new Error('DeepID rejected the request'));
    const recordSnapshotPublication = vi.fn().mockResolvedValue(undefined);

    // The failure must stay non-fatal: the workflow still resolves.
    await runWorkflow({ postSnapshotScores, recordSnapshotPublication });

    expect(recordSnapshotPublication.mock.calls.map(([input]) => input)).toEqual([
      { snapshotId: 'snapshot-1', algorithmKey: 'discord_engagement', status: 'pending' },
      {
        snapshotId: 'snapshot-1',
        algorithmKey: 'discord_engagement',
        status: 'failed',
        error: 'DeepID rejected the request',
      },
    ]);
  });

  it('keeps a ledger-write failure non-fatal for the run', async () => {
    const postSnapshotScores = vi
      .fn()
      .mockResolvedValue({ attempted: true, posted: 1, ok: 1, failed: 0, dropped: 0, skipped: 0 });
    const recordSnapshotPublication = vi.fn().mockRejectedValue(new Error('api activities queue is down'));

    await expect(runWorkflow({ postSnapshotScores, recordSnapshotPublication })).resolves.toBeUndefined();
    expect(postSnapshotScores).toHaveBeenCalledTimes(1);
  });
});
