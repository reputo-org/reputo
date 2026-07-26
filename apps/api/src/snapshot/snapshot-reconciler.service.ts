import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SnapshotStatus } from '@reputo/contracts';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { TemporalService } from '../temporal';
import type { SnapshotRow } from './snapshot.repository';
import { SnapshotRepository } from './snapshot.repository';
import { SnapshotService } from './snapshot.service';

/**
 * Periodic backstop that settles snapshots stuck in a non-terminal status.
 *
 * The workflow's own failure handler covers errors and cancellations while
 * workflow code runs, but nothing runs on run timeout, terminate, worker loss,
 * or a start that never happened. This service is the only mechanism that
 * converges the database projection with Temporal (the execution source of
 * truth) in those cases:
 *
 *  - queued/running rows whose workflow closed → `failed` / `cancelled`
 *  - queued rows whose workflow does not exist → start it (idempotent), and
 *    after a grace budget mark the row `failed`
 *
 * All writes go through `SnapshotService.applyExternalUpdate`, so the status
 * state machine, timestamps, and SSE notifications behave exactly as for
 * workflow-driven updates, and a race with a live workflow write resolves to
 * whichever commits first.
 */
@Injectable()
export class SnapshotReconcilerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly intervalMs: number;
  private readonly graceMs: number;
  private readonly startFailedAfterMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectPinoLogger(SnapshotReconcilerService.name)
    private readonly logger: PinoLogger,
    private readonly repository: SnapshotRepository,
    private readonly snapshotService: SnapshotService,
    private readonly temporalService: TemporalService,
    configService: ConfigService,
  ) {
    this.intervalMs = configService.get<number>('snapshot.reconcileIntervalMs') ?? 60_000;
    this.graceMs = configService.get<number>('snapshot.reconcileGraceMs') ?? 120_000;
    this.startFailedAfterMs = configService.get<number>('snapshot.startFailedAfterMs') ?? 600_000;
  }

  onApplicationBootstrap(): void {
    if (this.intervalMs <= 0) {
      this.logger.warn('Snapshot reconciler disabled (SNAPSHOT_RECONCILE_INTERVAL_MS=0)');
      return;
    }
    this.timer = setInterval(() => void this.reconcile(), this.intervalMs);
    this.timer.unref?.();
    // Immediate pass so rows stranded by a previous process settle right
    // after boot instead of one interval later.
    void this.reconcile();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async reconcile(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const cutoff = new Date(Date.now() - this.graceMs);
      const rows = await this.repository.findUnsettled(cutoff);
      for (const row of rows) {
        await this.reconcileRow(row);
      }
    } catch (error) {
      // Includes Temporal being unreachable; the next pass retries.
      this.logger.error(`Snapshot reconciliation pass failed: ${(error as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async reconcileRow(row: SnapshotRow): Promise<void> {
    const workflowId = row.temporal?.workflowId ?? this.temporalService.snapshotWorkflowId(row._id);
    const description = await this.temporalService.describeSnapshotWorkflow(workflowId);

    if (description.outcome === 'described') {
      switch (description.status) {
        case 'RUNNING':
        case 'CONTINUED_AS_NEW':
        case 'PAUSED':
          return;
        case 'CANCELLED':
          return this.settle(row, SnapshotStatus.cancelled, 'Workflow was cancelled');
        case 'COMPLETED':
          // Only the workflow writes `completed`, and it does so before the
          // run closes — a non-terminal row here means that write was lost.
          return this.settle(row, SnapshotStatus.failed, 'Workflow completed but the snapshot was never finalized');
        case 'FAILED':
        case 'TERMINATED':
        case 'TIMED_OUT':
          return this.settle(row, SnapshotStatus.failed, `Workflow closed as ${description.status}`);
        default:
          return;
      }
    }

    // No execution exists: the start was lost, or retention already elapsed.
    if (row.status === SnapshotStatus.queued) {
      try {
        await this.temporalService.startRunSnapshotWorkflow(row._id);
        this.logger.warn({ snapshotId: row._id, workflowId }, 'Started workflow for an orphaned queued snapshot');
      } catch (error) {
        this.logger.warn(
          { snapshotId: row._id, workflowId },
          `Retrying workflow start for a queued snapshot failed: ${(error as Error).message}`,
        );
        if (Date.now() - row.createdAt.getTime() >= this.startFailedAfterMs) {
          await this.settle(row, SnapshotStatus.failed, 'Workflow could not be started');
        }
      }
      return;
    }

    await this.settle(row, SnapshotStatus.failed, 'Workflow no longer exists');
  }

  private async settle(row: SnapshotRow, status: SnapshotStatus, message: string): Promise<void> {
    this.logger.warn({ snapshotId: row._id, from: row.status, to: status, reason: message }, 'Reconciling snapshot');
    await this.snapshotService.applyExternalUpdate({
      snapshotId: row._id,
      status,
      error: { message },
    });
  }
}
