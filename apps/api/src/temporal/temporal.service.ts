import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, Connection } from '@temporalio/client';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { WORKFLOW_RUN_TIMEOUT } from '../shared/constants/temporal.constants';

// Minimal projection of a snapshot used by the workflow lifecycle helpers
// below. The repository's `SnapshotRow` and any equivalent DTO satisfy this
// shape, so callers do not need a runtime conversion.
export interface TerminableSnapshot {
  status: string;
  temporal?: { workflowId?: string } | null;
}

/**
 * Service for interacting with Temporal workflows.
 *
 * Manages Temporal client connection and provides methods to start workflows.
 */
@Injectable()
export class TemporalService implements OnModuleInit, OnModuleDestroy {
  private connection: Connection | null = null;
  private client: Client | null = null;

  constructor(
    @InjectPinoLogger(TemporalService.name)
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Initialize Temporal connection and client on module initialization.
   */
  async onModuleInit(): Promise<void> {
    try {
      const address = this.configService.get<string>('temporal.address');
      const namespace = this.configService.get<string>('temporal.namespace');

      this.logger.info(`Connecting to Temporal at ${address} (namespace: ${namespace})`);

      this.connection = await Connection.connect({
        address,
      });

      this.client = new Client({
        connection: this.connection,
        namespace,
      });

      this.logger.info('Temporal client connected successfully');
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to connect to Temporal: ${err.message}`, err.stack);
      // Don't throw - allow app to start even if Temporal is unavailable
    }
  }

  /**
   * Close Temporal connection on module destruction.
   */
  async onModuleDestroy(): Promise<void> {
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

  /**
   * Starts the OrchestratorWorkflow for a given snapshot.
   *
   * @param snapshotId - UUID v7 of the snapshot to execute
   * @returns Promise that resolves when workflow is started
   * @throws Error if Temporal client is not available or workflow start fails
   */
  async startRunSnapshotWorkflow(snapshotId: string): Promise<void> {
    if (!this.client) {
      throw new Error('Temporal client is not available. Check TEMPORAL_ADDRESS configuration.');
    }

    const orchestratorTaskQueue = this.configService.get<string>('temporal.orchestratorTaskQueue') as string;
    const workflowId = `snapshot-${snapshotId}`;

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
      this.logger.error(`Failed to start OrchestratorWorkflow for snapshot ${snapshotId}: ${err.message}`, err.stack, {
        workflowId,
        taskQueue: orchestratorTaskQueue,
        snapshotId,
      });
      throw error;
    }
  }

  /**
   * Fire-and-forget start for snapshot workflow with error logging only.
   */
  async startSnapshotWorkflow(snapshotId: string): Promise<void> {
    try {
      await this.startRunSnapshotWorkflow(snapshotId);
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to start workflow for snapshot ${snapshotId}: ${err.message}`, err.stack, {
        snapshotId,
      });
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
      // WorkflowNotFoundError means workflow already completed or doesn't exist
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
          // Wait for the workflow to complete (will throw when terminated)
          await handle.result();
        } catch (error) {
          // Expected: terminated workflows throw an error
          const err = error as Error;
          if (err.name === 'WorkflowExecutionTerminatedError' || err.message?.includes('terminated')) {
            this.logger.info(`Workflow ${workflowId} confirmed terminated`);
          } else {
            // Unexpected error, but workflow is in terminal state
            this.logger.warn(`Workflow ${workflowId} ended with unexpected error: ${err.message}`);
          }
        }
      }
    } catch (error) {
      const err = error as Error;
      // WorkflowNotFoundError means workflow already completed or doesn't exist
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
   * Cancels workflows for all running snapshots.
   */
  async cancelSnapshotWorkflows(snapshots: TerminableSnapshot[]): Promise<void> {
    const runningSnapshots = snapshots.filter(
      (snapshot) => snapshot.status === 'running' && snapshot.temporal?.workflowId,
    );

    for (const snapshot of runningSnapshots) {
      const workflowId = snapshot.temporal?.workflowId;
      if (workflowId) {
        await this.cancelSnapshotWorkflow(workflowId);
      }
    }
  }

  /**
   * Terminates workflows for all running snapshots.
   *
   * This immediately stops all running workflows without allowing cleanup.
   * Used when deleting algorithm presets or snapshots.
   *
   * @param snapshots - Array of snapshots to terminate workflows for
   * @param waitForCompletion - If true, waits for all workflows to reach terminal state before returning
   */
  async terminateSnapshotWorkflows(snapshots: TerminableSnapshot[], waitForCompletion = false): Promise<void> {
    const runningSnapshots = snapshots.filter(
      (snapshot) => snapshot.status === 'running' && snapshot.temporal?.workflowId,
    );

    if (runningSnapshots.length === 0) {
      return;
    }

    this.logger.info(`Terminating ${runningSnapshots.length} running workflow(s)`, {
      waitForCompletion,
    });

    // Terminate all workflows in parallel
    await Promise.all(
      runningSnapshots.map((snapshot) => {
        const workflowId = snapshot.temporal?.workflowId;
        if (workflowId) {
          return this.terminateSnapshotWorkflow(workflowId, waitForCompletion);
        }
        return Promise.resolve();
      }),
    );

    this.logger.info(`All ${runningSnapshots.length} workflow(s) terminated`);
  }
}
