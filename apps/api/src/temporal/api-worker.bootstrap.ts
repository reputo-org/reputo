import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { API_SNAPSHOT_ACTIVITIES_TASK_QUEUE } from '@reputo/contracts';
import { NativeConnection, Worker } from '@temporalio/worker';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { SnapshotService } from '../snapshot/snapshot.service';
import { createSnapshotActivities } from './snapshot.activities';

/**
 * Hosts the API-side Temporal activity worker alongside the HTTP server.
 *
 * Lifecycle is coupled to NestJS: the worker is created and started during
 * `OnApplicationBootstrap`, and drained cleanly during `OnApplicationShutdown`
 * (which fires on SIGINT/SIGTERM when shutdown hooks are enabled in `main.ts`).
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

  constructor(
    @InjectPinoLogger(ApiWorkerBootstrap.name)
    private readonly logger: PinoLogger,
    private readonly configService: ConfigService,
    private readonly snapshotService: SnapshotService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const address = this.configService.get<string>('temporal.address');
    if (!address) {
      this.logger.warn('TEMPORAL_ADDRESS not set — API snapshot activities worker disabled');
      return;
    }
    const namespace = this.configService.get<string>('temporal.namespace') ?? 'default';
    const taskQueue =
      this.configService.get<string>('temporal.apiSnapshotActivitiesTaskQueue') ?? API_SNAPSHOT_ACTIVITIES_TASK_QUEUE;

    try {
      this.logger.info({ address, namespace, taskQueue }, 'Connecting API snapshot activities worker to Temporal');

      this.connection = await NativeConnection.connect({ address });
      this.worker = await Worker.create({
        connection: this.connection,
        namespace,
        taskQueue,
        activities: createSnapshotActivities(this.snapshotService),
      });

      // worker.run() resolves when the worker drains. Track the promise so
      // shutdown can await full drain; swallow errors after logging so a
      // poll failure does not bring down the HTTP server.
      this.runPromise = this.worker.run().catch((err) => {
        const e = err as Error;
        this.logger.error(`API snapshot activities worker exited with error: ${e.message}`, e.stack);
      });

      this.logger.info({ taskQueue }, 'API snapshot activities worker started');
    } catch (error) {
      const err = error as Error;
      this.logger.error(`Failed to start API snapshot activities worker: ${err.message}`, err.stack);
    }
  }

  async onApplicationShutdown(): Promise<void> {
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
    }
  }
}
