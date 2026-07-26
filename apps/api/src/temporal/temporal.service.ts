import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Connection } from '@temporalio/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { WORKFLOW_RUN_TIMEOUT } from '../shared/constants/temporal.constants';

export interface TerminableSnapshot {
  _id?: string;
  status: string;
  temporal?: { workflowId?: string } | null;
}

export type TemporalAvailability = 'up' | 'down';

export type SnapshotWorkflowDescription = { outcome: 'described'; status: string } | { outcome: 'not_found' };

const ACTIVE_SNAPSHOT_STATUSES: readonly string[] = ['queued', 'running'];

@Injectable()
export class TemporalService implements OnModuleInit, OnModuleDestroy {
  private connection: Connection | null = null;
  private client: Client | null = null;
  private available = false;
  private healthTimer: NodeJS.Timeout | null = null;
  private healthCheckInFlight = false;

  constructor(
    @InjectPinoLogger(TemporalService.name)
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService,
  ) {}

  /**
   * The connection is lazy: it dials on first use and recovers on its own, so
   * Temporal being down while the API boots never permanently disables
   * workflow starts (the previous eager connect left `client` null forever).
   * A periodic gRPC health probe keeps `getAvailability()` fresh for /health
   * without putting a Temporal round-trip on the health request path.
   */
  onModuleInit(): void {
    const address = this.configService.get<string>('temporal.address');
    const namespace = this.configService.get<string>('temporal.namespace');

    this.logger.info(`Creating lazy Temporal connection to ${address} (namespace: ${namespace})`);

    this.connection = Connection.lazy({ address });
    this.client = new Client({
      connection: this.connection,
      namespace,
    });

    const probeIntervalMs = this.configService.get<number>('temporal.healthCheckIntervalMs') ?? 30_000;
    if (probeIntervalMs > 0) {
      this.healthTimer = setInterval(() => void this.refreshAvailability(), probeIntervalMs);
      this.healthTimer.unref?.();
      void this.refreshAvailability();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    try {
      if (this.connection) {
        await this.connection.close();
        this.logger.info('Temporal connection closed');
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error closing Temporal connection: ${err.message}`, err.stack);
    }
  }

  /** Last observed reachability of the Temporal server (updated by the probe). */
  getAvailability(): TemporalAvailability {
    return this.available ? 'up' : 'down';
  }

  private async refreshAvailability(): Promise<void> {
    if (!this.connection || this.healthCheckInFlight) return;
    this.healthCheckInFlight = true;
    try {
      await this.connection.healthService.check({});
      this.setAvailability(true);
    } catch (error) {
      this.setAvailability(false, error as Error);
    } finally {
      this.healthCheckInFlight = false;
    }
  }

  private setAvailability(up: boolean, cause?: Error): void {
    if (this.available === up) return;
    this.available = up;
    if (up) {
      this.logger.info('Temporal server is reachable');
    } else {
      this.logger.error(`Temporal server is unreachable: ${cause?.message ?? 'unknown error'}`);
    }
  }

  /** Deterministic workflow id for a snapshot; also derivable for legacy rows. */
  snapshotWorkflowId(snapshotId: string): string {
    return `snapshot-${snapshotId}`;
  }

  /**
   * Starts the OrchestratorWorkflow for a given snapshot.
   *
   * Idempotent: a workflow that is already running for this snapshot counts
   * as a successful start, so create-time retries and the reconciler can call
   * this without coordination.
   *
   * @param snapshotId - UUID v7 of the snapshot to execute
   * @returns The deterministic workflow id
   * @throws Error if Temporal client is not available or workflow start fails
   */
  async startRunSnapshotWorkflow(snapshotId: string): Promise<{ workflowId: string }> {
    if (!this.client) {
      throw new Error('Temporal client is not available. Check TEMPORAL_ADDRESS configuration.');
    }

    const orchestratorTaskQueue = this.configService.get<string>('temporal.orchestratorTaskQueue') as string;
    const workflowId = this.snapshotWorkflowId(snapshotId);

    try {
      this.logger.info(`Starting OrchestratorWorkflow for snapshot ${snapshotId}`, {
        workflowId,
        taskQueue: orchestratorTaskQueue,
        snapshotId,
      });

      await this.client.workflow.start('OrchestratorWorkflow', {
        taskQueue: orchestratorTaskQueue,
        workflowId,
        workflowRunTimeout: WORKFLOW_RUN_TIMEOUT,
        args: [
          {
            snapshotId,
          },
        ],
      });

      this.logger.info(`OrchestratorWorkflow started successfully for snapshot ${snapshotId}`, {
        workflowId,
        snapshotId,
      });
    } catch (error) {
      const err = error as Error;
      if (err.name === 'WorkflowExecutionAlreadyStartedError') {
        this.logger.warn(`OrchestratorWorkflow already started for snapshot ${snapshotId}`, {
          workflowId,
          snapshotId,
        });
        return { workflowId };
      }
      this.logger.error(`Failed to start OrchestratorWorkflow for snapshot ${snapshotId}: ${err.message}`, err.stack, {
        workflowId,
        taskQueue: orchestratorTaskQueue,
        snapshotId,
      });
      throw error;
    }

    return { workflowId };
  }

  /**
   * Describes the workflow execution behind a snapshot.
   *
   * @returns The Temporal close/run status name, or `not_found` when no
   *   execution exists (never started, or already past retention)
   * @throws Error on transport failures so callers can tell "gone" from
   *   "unreachable"
   */
  async describeSnapshotWorkflow(workflowId: string): Promise<SnapshotWorkflowDescription> {
    if (!this.client) {
      throw new Error('Temporal client is not available. Check TEMPORAL_ADDRESS configuration.');
    }

    try {
      const description = await this.client.workflow.getHandle(workflowId).describe();
      return { outcome: 'described', status: description.status.name };
    } catch (error) {
      if ((error as Error).name === 'WorkflowNotFoundError') {
        return { outcome: 'not_found' };
      }
      throw error;
    }
  }

  /**
   * Cancels a running Temporal workflow by its workflow ID.
   *
   * This is a graceful cancellation - the workflow can handle the cancellation
   * and perform cleanup before completing.
   *
   * @param workflowId - The Temporal workflow ID to cancel
   * @throws Error if Temporal client is not available
   */
  async cancelWorkflow(workflowId: string): Promise<void> {
    if (!this.client) {
      throw new Error('Temporal client is not available. Check TEMPORAL_ADDRESS configuration.');
    }

    try {
      this.logger.info(`Cancelling workflow ${workflowId}`);

      const handle = this.client.workflow.getHandle(workflowId);
      await handle.cancel();

      this.logger.info(`Workflow ${workflowId} cancelled successfully`);
    } catch (error) {
      const err = error as Error;
      if (err.name === 'WorkflowNotFoundError') {
        this.logger.warn(`Workflow ${workflowId} not found, may have already completed`);
        return;
      }
      this.logger.error(`Failed to cancel workflow ${workflowId}: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Terminates a running Temporal workflow immediately without cleanup.
   *
   * This forces the workflow to stop immediately without giving it a chance
   * to handle cancellation or perform cleanup. Use this when you need to
   * ensure the workflow stops right away.
   *
   * @param workflowId - The Temporal workflow ID to terminate
   * @param waitForCompletion - If true, waits for workflow to reach terminal state before returning
   * @throws Error if Temporal client is not available
   */
  async terminateWorkflow(workflowId: string, waitForCompletion = false): Promise<void> {
    if (!this.client) {
      throw new Error('Temporal client is not available. Check TEMPORAL_ADDRESS configuration.');
    }

    try {
      this.logger.info(`Terminating workflow ${workflowId}`);

      const handle = this.client.workflow.getHandle(workflowId);
      await handle.terminate('Workflow terminated due to algorithm preset or snapshot deletion');

      this.logger.info(`Workflow ${workflowId} termination request sent`);

      if (waitForCompletion) {
        this.logger.info(`Waiting for workflow ${workflowId} to reach terminal state`);
        try {
          await handle.result();
        } catch (error) {
          const err = error as Error;
          if (err.name === 'WorkflowExecutionTerminatedError' || err.message?.includes('terminated')) {
            this.logger.info(`Workflow ${workflowId} confirmed terminated`);
          } else {
            this.logger.warn(`Workflow ${workflowId} ended with unexpected error: ${err.message}`);
          }
        }
      }
    } catch (error) {
      const err = error as Error;
      if (err.name === 'WorkflowNotFoundError') {
        this.logger.warn(`Workflow ${workflowId} not found, may have already completed`);
        return;
      }
      this.logger.error(`Failed to terminate workflow ${workflowId}: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Safe cancellation wrapper that logs errors but does not throw.
   */
  async cancelSnapshotWorkflow(workflowId: string): Promise<void> {
    try {
      await this.cancelWorkflow(workflowId);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to cancel workflow ${workflowId}: ${err.message}`, err.stack);
    }
  }

  /**
   * Safe termination wrapper that logs errors but does not throw.
   *
   * @param workflowId - The Temporal workflow ID to terminate
   * @param waitForCompletion - If true, waits for workflow to reach terminal state before returning
   */
  async terminateSnapshotWorkflow(workflowId: string, waitForCompletion = false): Promise<void> {
    try {
      await this.terminateWorkflow(workflowId, waitForCompletion);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to terminate workflow ${workflowId}: ${err.message}`, err.stack);
    }
  }

  /**
   * Workflow ids for snapshots that may have a live execution: queued or
   * running rows. Queued rows already have a started workflow (the id is
   * persisted at create time); for legacy rows without one the deterministic
   * id is derived from the snapshot id.
   */
  private collectActiveWorkflowIds(snapshots: TerminableSnapshot[]): string[] {
    const workflowIds: string[] = [];
    for (const snapshot of snapshots) {
      if (!ACTIVE_SNAPSHOT_STATUSES.includes(snapshot.status)) continue;
      const workflowId =
        snapshot.temporal?.workflowId ?? (snapshot._id ? this.snapshotWorkflowId(snapshot._id) : undefined);
      if (workflowId) workflowIds.push(workflowId);
    }
    return workflowIds;
  }

  async cancelSnapshotWorkflows(snapshots: TerminableSnapshot[]): Promise<void> {
    for (const workflowId of this.collectActiveWorkflowIds(snapshots)) {
      await this.cancelSnapshotWorkflow(workflowId);
    }
  }

  /**
   * Terminates workflows for all queued/running snapshots.
   *
   * This immediately stops the workflows without allowing cleanup.
   * Used when deleting algorithm presets or snapshots.
   *
   * @param snapshots - Array of snapshots to terminate workflows for
   * @param waitForCompletion - If true, waits for all workflows to reach terminal state before returning
   */
  async terminateSnapshotWorkflows(snapshots: TerminableSnapshot[], waitForCompletion = false): Promise<void> {
    const workflowIds = this.collectActiveWorkflowIds(snapshots);

    if (workflowIds.length === 0) {
      return;
    }

    this.logger.info(`Terminating ${workflowIds.length} active workflow(s)`, {
      waitForCompletion,
    });

    await Promise.all(workflowIds.map((workflowId) => this.terminateSnapshotWorkflow(workflowId, waitForCompletion)));

    this.logger.info(`All ${workflowIds.length} workflow(s) terminated`);
  }
}
