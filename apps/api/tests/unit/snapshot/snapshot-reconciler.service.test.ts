import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SnapshotRepository, SnapshotRow } from '../../../src/snapshot/snapshot.repository';
import type { SnapshotService } from '../../../src/snapshot/snapshot.service';
import { SnapshotReconcilerService } from '../../../src/snapshot/snapshot-reconciler.service';
import type { TemporalService } from '../../../src/temporal';

const SNAPSHOT_ID = '01940000-0000-7000-8000-000000000001';

function makeRow(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    _id: SNAPSHOT_ID,
    status: 'running',
    algorithmPreset: 'preset-1',
    algorithmPresetFrozen: { key: 'k', version: '1.0.0', inputs: [] },
    temporal: { workflowId: `snapshot-${SNAPSHOT_ID}` },
    createdAt: new Date(Date.now() - 30 * 60_000),
    updatedAt: new Date(Date.now() - 10 * 60_000),
    ...overrides,
  } as SnapshotRow;
}

describe('SnapshotReconcilerService', () => {
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    setContext: vi.fn(),
  };

  let repository: { findUnsettled: ReturnType<typeof vi.fn> };
  let snapshotService: { applyExternalUpdate: ReturnType<typeof vi.fn> };
  let temporalService: {
    snapshotWorkflowId: ReturnType<typeof vi.fn>;
    describeSnapshotWorkflow: ReturnType<typeof vi.fn>;
    startRunSnapshotWorkflow: ReturnType<typeof vi.fn>;
  };
  let service: SnapshotReconcilerService;

  beforeEach(() => {
    vi.clearAllMocks();

    repository = { findUnsettled: vi.fn().mockResolvedValue([]) };
    snapshotService = { applyExternalUpdate: vi.fn().mockResolvedValue(null) };
    temporalService = {
      snapshotWorkflowId: vi.fn((id: string) => `snapshot-${id}`),
      describeSnapshotWorkflow: vi.fn(),
      startRunSnapshotWorkflow: vi.fn().mockImplementation(async (id: string) => ({ workflowId: `snapshot-${id}` })),
    };

    const configService = {
      get: vi.fn((key: string) => {
        const values: Record<string, number> = {
          'snapshot.reconcileIntervalMs': 60_000,
          'snapshot.reconcileGraceMs': 120_000,
          'snapshot.startFailedAfterMs': 600_000,
        };
        return values[key];
      }),
    } as unknown as ConfigService;

    service = new SnapshotReconcilerService(
      mockLogger as never,
      repository as unknown as SnapshotRepository,
      snapshotService as unknown as SnapshotService,
      temporalService as unknown as TemporalService,
      configService,
    );
  });

  it('leaves rows alone while their workflow is still running', async () => {
    repository.findUnsettled.mockResolvedValue([makeRow()]);
    temporalService.describeSnapshotWorkflow.mockResolvedValue({ outcome: 'described', status: 'RUNNING' });

    await service.reconcile();

    expect(snapshotService.applyExternalUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['FAILED', 'failed'],
    ['TERMINATED', 'failed'],
    ['TIMED_OUT', 'failed'],
    ['CANCELLED', 'cancelled'],
  ])('settles a running row whose workflow closed as %s', async (workflowStatus, expected) => {
    repository.findUnsettled.mockResolvedValue([makeRow()]);
    temporalService.describeSnapshotWorkflow.mockResolvedValue({ outcome: 'described', status: workflowStatus });

    await service.reconcile();

    expect(snapshotService.applyExternalUpdate).toHaveBeenCalledWith({
      snapshotId: SNAPSHOT_ID,
      status: expected,
      error: { message: expect.any(String) },
    });
  });

  it('marks a non-terminal row failed when its workflow completed without finalizing it', async () => {
    repository.findUnsettled.mockResolvedValue([makeRow()]);
    temporalService.describeSnapshotWorkflow.mockResolvedValue({ outcome: 'described', status: 'COMPLETED' });

    await service.reconcile();

    expect(snapshotService.applyExternalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ snapshotId: SNAPSHOT_ID, status: 'failed' }),
    );
  });

  it('restarts the workflow of an orphaned queued row instead of failing it', async () => {
    repository.findUnsettled.mockResolvedValue([makeRow({ status: 'queued', temporal: undefined })]);
    temporalService.describeSnapshotWorkflow.mockResolvedValue({ outcome: 'not_found' });

    await service.reconcile();

    expect(temporalService.describeSnapshotWorkflow).toHaveBeenCalledWith(`snapshot-${SNAPSHOT_ID}`);
    expect(temporalService.startRunSnapshotWorkflow).toHaveBeenCalledWith(SNAPSHOT_ID);
    expect(snapshotService.applyExternalUpdate).not.toHaveBeenCalled();
  });

  it('fails a queued row when the start keeps failing past the grace budget', async () => {
    repository.findUnsettled.mockResolvedValue([
      makeRow({ status: 'queued', createdAt: new Date(Date.now() - 11 * 60_000) }),
    ]);
    temporalService.describeSnapshotWorkflow.mockResolvedValue({ outcome: 'not_found' });
    temporalService.startRunSnapshotWorkflow.mockRejectedValue(new Error('still down'));

    await service.reconcile();

    expect(snapshotService.applyExternalUpdate).toHaveBeenCalledWith({
      snapshotId: SNAPSHOT_ID,
      status: 'failed',
      error: { message: 'Workflow could not be started' },
    });
  });

  it('keeps retrying a young queued row without failing it yet', async () => {
    repository.findUnsettled.mockResolvedValue([
      makeRow({ status: 'queued', createdAt: new Date(Date.now() - 3 * 60_000) }),
    ]);
    temporalService.describeSnapshotWorkflow.mockResolvedValue({ outcome: 'not_found' });
    temporalService.startRunSnapshotWorkflow.mockRejectedValue(new Error('still down'));

    await service.reconcile();

    expect(snapshotService.applyExternalUpdate).not.toHaveBeenCalled();
  });

  it('fails a running row whose workflow no longer exists', async () => {
    repository.findUnsettled.mockResolvedValue([makeRow()]);
    temporalService.describeSnapshotWorkflow.mockResolvedValue({ outcome: 'not_found' });

    await service.reconcile();

    expect(snapshotService.applyExternalUpdate).toHaveBeenCalledWith({
      snapshotId: SNAPSHOT_ID,
      status: 'failed',
      error: { message: 'Workflow no longer exists' },
    });
  });

  it('logs and aborts the pass when Temporal is unreachable, without writing anything', async () => {
    repository.findUnsettled.mockResolvedValue([makeRow(), makeRow({ _id: 'other' })]);
    temporalService.describeSnapshotWorkflow.mockRejectedValue(new Error('transport down'));

    await expect(service.reconcile()).resolves.toBeUndefined();

    expect(snapshotService.applyExternalUpdate).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('transport down'));
  });

  it('uses the persisted workflow id when the row has one', async () => {
    repository.findUnsettled.mockResolvedValue([makeRow({ temporal: { workflowId: 'wf-custom' } })]);
    temporalService.describeSnapshotWorkflow.mockResolvedValue({ outcome: 'described', status: 'RUNNING' });

    await service.reconcile();

    expect(temporalService.describeSnapshotWorkflow).toHaveBeenCalledWith('wf-custom');
  });
});
