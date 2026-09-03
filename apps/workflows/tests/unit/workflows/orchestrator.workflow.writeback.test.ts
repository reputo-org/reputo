import { describe, expect, it, vi } from 'vitest';
import { SnapshotStatus } from '../../../src/shared/constants/index.js';

const { ApplicationFailure, TemporalFailure, CancelledFailure } = vi.hoisted(() => {
  class TemporalFailure extends Error {}
  class ApplicationFailure extends TemporalFailure {
    type?: string;
    nonRetryable?: boolean;
    static create({ message, type, nonRetryable }: { message: string; type?: string; nonRetryable?: boolean }) {
      const failure = new ApplicationFailure(message);
      failure.type = type;
      failure.nonRetryable = nonRetryable;
      return failure;
    }
  }
  class CancelledFailure extends TemporalFailure {}
  return { ApplicationFailure, TemporalFailure, CancelledFailure };
});

vi.mock('@temporalio/workflow', () => ({
  proxyActivities: vi.fn(),
  workflowInfo: vi.fn(),
  sleep: vi.fn(async () => {}),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  isCancellation: (error: unknown) => error instanceof CancelledFailure,
  CancellationScope: { nonCancellable: async (fn: () => Promise<unknown>) => fn() },
  ApplicationFailure,
  TemporalFailure,
}));

/** Boots the workflow against a Discord community preset whose fetch fails. */
async function runWithFailingFetch(options: { fetchError: Error; healthMock: ReturnType<typeof vi.fn> }) {
  vi.resetModules();

  const temporalWorkflow = await import('@temporalio/workflow');
  vi.mocked(temporalWorkflow.workflowInfo).mockReturnValue({
    workflowId: 'wf-1',
    runId: 'run-1',
    taskQueue: 'orchestrator-q',
    startTime: new Date('2026-08-29T10:30:00.000Z'),
  } as never);

  const updateSnapshot = vi.fn().mockResolvedValue(undefined);
  const activities = {
    getSnapshot: vi.fn().mockResolvedValue({
      status: SnapshotStatus.queued,
      algorithmPresetFrozen: {
        key: 'discord_engagement',
        version: '1.0.0',
        inputs: [
          { key: 'community_connection_id', value: 'conn-1' },
          { key: 'lookback_days', value: 90 },
          { key: 'resources', value: ['111'] },
        ],
      },
    }),
    updateSnapshot,
    getCommunityConnection: vi.fn().mockResolvedValue({
      id: 'conn-1',
      platform: 'discord',
      externalId: 'guild-1',
      name: 'Guild',
      status: 'active',
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    }),
    getAlgorithmDefinition: vi.fn().mockResolvedValue({
      algorithmDefinition: {
        key: 'discord_engagement',
        version: '1.0.0',
        runtime: 'typescript',
        dependencies: [{ key: 'discord-activity' }],
      },
    }),
    resolveDependency: vi.fn().mockRejectedValue(options.fetchError),
    checkCommunityConnectionHealth: options.healthMock,
    runTypescriptAlgorithm: vi.fn(),
  };
  vi.mocked(temporalWorkflow.proxyActivities).mockImplementation(() => activities as never);

  const { OrchestratorWorkflow } = await import('../../../src/workflows/orchestrator.workflow.js');
  const outcome = await OrchestratorWorkflow({ snapshotId: 'snapshot-1' }).then(
    () => {
      throw new Error('expected the workflow to fail');
    },
    (error: Error) => error,
  );

  return { outcome, updateSnapshot, health: options.healthMock };
}

describe('OrchestratorWorkflow community health write-back', () => {
  it('re-checks the connection when the community fetch fails, then still fails the snapshot', async () => {
    const fetchError = ApplicationFailure.create({
      message: 'Community discord fetch failed: auth_failed',
      type: 'CommunityFetchError',
      nonRetryable: true,
    });
    const healthMock = vi.fn().mockResolvedValue({ status: 'broken', checkedAt: '2026-08-29T10:31:00.000Z' });

    const { outcome, updateSnapshot, health } = await runWithFailingFetch({ fetchError, healthMock });

    expect(health).toHaveBeenCalledExactlyOnceWith({ connectionId: 'conn-1' });
    expect(outcome.message).toBe('Community discord fetch failed: auth_failed');
    expect(updateSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotId: 'snapshot-1',
        status: SnapshotStatus.failed,
        error: { message: 'Community discord fetch failed: auth_failed' },
      }),
    );
  });

  it('swallows a write-back failure and keeps the original error', async () => {
    const fetchError = ApplicationFailure.create({
      message: 'Community discord fetch failed: permission_denied',
      type: 'CommunityFetchError',
      nonRetryable: true,
    });
    const healthMock = vi.fn().mockRejectedValue(new Error('API activity queue unavailable'));

    const { outcome } = await runWithFailingFetch({ fetchError, healthMock });

    expect(healthMock).toHaveBeenCalledOnce();
    expect(outcome.message).toBe('Community discord fetch failed: permission_denied');
  });

  it('skips the write-back entirely on cancellation', async () => {
    const healthMock = vi.fn();

    const { outcome, updateSnapshot } = await runWithFailingFetch({
      fetchError: new CancelledFailure('cancelled'),
      healthMock,
    });

    expect(healthMock).not.toHaveBeenCalled();
    expect(outcome).toBeInstanceOf(CancelledFailure);
    expect(updateSnapshot).toHaveBeenCalledWith(expect.objectContaining({ status: SnapshotStatus.cancelled }));
  });
});
