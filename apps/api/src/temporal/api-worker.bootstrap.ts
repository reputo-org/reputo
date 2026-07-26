import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { API_SNAPSHOT_ACTIVITIES_TASK_QUEUE } from '@reputo/contracts';
import { NativeConnection, Worker } from '@temporalio/worker';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { SnapshotService } from '../snapshot/snapshot.service';
import { ApiWorkerStatus } from './api-worker.status';
import { createSnapshotActivities } from './snapshot.activities';

const RETRY_INITIAL_DELAY_MS = 5_000;
const RETRY_MAX_DELAY_MS = 60_000;

/**
 * Hosts the API-side Temporal activity worker alongside the HTTP server.
 *
 * Lifecycle is coupled to NestJS: the worker is created and started during
 * `OnApplicationBootstrap`, and drained cleanly during `OnApplicationShutdown`
 * (which fires on SIGINT/SIGTERM when shutdown hooks are enabled in `main.ts`).
 *
 * Startup failures and unexpected worker exits schedule a retry with capped
 * backoff instead of leaving the activity plane dead until the next container
 * restart. The current state is published through `ApiWorkerStatus` for the
 * health endpoint.
 *
 * If `TEMPORAL_ADDRESS` is unset (e.g. local dev without Temporal, unit tests
 * that bypass this module), the worker is skipped — the HTTP server still binds
 * and behaves identically.
 */
@Injectable()
export class ApiWorkerBootstrap implements OnApplicationBootstrap, OnApplicationShutdown {
  private connection: NativeConnection | null = null;
  private worker: Worker | null = null;
  private runPromise: Promise<void> | null = null;
  private startPromise: Promise<void> | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private failedAttempts = 0;
  private shuttingDown = false;

  constructor(
    @InjectPinoLogger(ApiWorkerBootstrap.name)
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService,
    private readonly snapshotService: SnapshotService,
    private readonly workerStatus: ApiWorkerStatus,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const address = this.configService.get<string>('temporal.address');
    if (!address) {
      this.logger.warn('TEMPORAL_ADDRESS not set — API snapshot activities worker disabled');
      this.workerStatus.set('disabled');
      return;
    }
    this.startPromise = this.startWorker();
    await this.startPromise;
  }

  private async startWorker(): Promise<void> {
    if (this.shuttingDown) return;

    const address = this.configService.get<string>('temporal.address');
    const namespace = this.configService.get<string>('temporal.namespace') ?? 'default';
    const taskQueue =
      this.configService.get<string>('temporal.apiSnapshotActivitiesTaskQueue') ?? API_SNAPSHOT_ACTIVITIES_TASK_QUEUE;

    try {
      this.logger.info({ address, namespace, taskQueue }, 'Connecting API snapshot activities worker to Temporal');

      this.connection = await NativeConnection.connect({ address });
      // Shutdown may have begun while the connect was in flight; continuing
      // would start a worker in a process that believes it already stopped.
      if (this.shuttingDown) {
        await this.closeConnection();
        return;
      }
      this.worker = await Worker.create({
        connection: this.connection,
        namespace,
        taskQueue,
        activities: createSnapshotActivities(this.snapshotService),
      });
      if (this.shuttingDown) {
        this.worker = null;
        await this.closeConnection();
        return;
      }

      this.failedAttempts = 0;
      this.workerStatus.set('up');

      this.runPromise = this.worker
        .run()
        .catch((err) => {
          const e = err as Error;
          this.logger.error(`API snapshot activities worker exited with error: ${e.message}`, e.stack);
        })
        .finally(() => {
          this.workerStatus.set('down');
          this.worker = null;
          if (!this.shuttingDown) {
            this.logger.warn('API snapshot activities worker stopped unexpectedly — scheduling restart');
            void this.closeConnection();
            this.scheduleRestart();
          }
        });

      this.logger.info({ taskQueue }, 'API snapshot activities worker started');
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to start API snapshot activities worker: ${err.message}`, err.stack);
      this.workerStatus.set('down');
      await this.closeConnection();
      this.scheduleRestart();
    }
  }

  private scheduleRestart(): void {
    if (this.shuttingDown || this.retryTimer) return;
    this.failedAttempts += 1;
    const delayMs = Math.min(RETRY_INITIAL_DELAY_MS * 2 ** (this.failedAttempts - 1), RETRY_MAX_DELAY_MS);
    this.logger.info(`Retrying API snapshot activities worker start in ${delayMs}ms`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.startPromise = this.startWorker();
    }, delayMs);
    this.retryTimer.unref?.();
  }

  private async closeConnection(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    if (!connection) return;
    try {
      await connection.close();
    } catch (error) {
      this.logger.warn(`Error closing API worker connection: ${(error as Error).message}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    // Wait for any in-flight start attempt so its outcome (a worker to drain,
    // or a connection it abandoned) is visible to the teardown below.
    if (this.startPromise) {
      await this.startPromise;
      this.startPromise = null;
    }
    try {
      if (this.worker) {
        try {
          await this.worker.shutdown();
          this.logger.info('API snapshot activities worker shutdown initiated');
        } catch (shutdownErr) {
          const msg = shutdownErr instanceof Error ? shutdownErr.message : String(shutdownErr);
          if (msg.includes('STOPPED') || msg.includes('Not running')) {
            this.logger.info('API snapshot activities worker already stopped');
          } else {
            throw shutdownErr;
          }
        }
      }
      if (this.runPromise) {
        await this.runPromise;
        this.logger.info('API snapshot activities worker fully drained');
      }
      if (this.connection) {
        await this.connection.close();
        this.logger.info('API snapshot activities worker connection closed');
      }
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Error during API snapshot activities worker shutdown: ${err.message}`, err.stack);
    } finally {
      this.worker = null;
      this.runPromise = null;
      this.connection = null;
      this.workerStatus.set('down');
    }
  }
}
