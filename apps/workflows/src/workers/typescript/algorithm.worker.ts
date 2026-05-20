import { createS3Client, Storage } from '@reputo/storage';
import { NativeConnection, Worker } from '@temporalio/worker';

import { dispatchAlgorithm } from '../../activities/typescript/dispatchAlgorithm.activity.js';
import config from '../../config/index.js';
import { TYPESCRIPT_ALGORITHM_WORKER_MAX_CONCURRENT_ACTIVITIES } from '../../shared/constants/index.js';
import { logger } from '../../shared/utils/index.js';

async function run(): Promise<void> {
  logger.info('Starting TypeScript Algorithm Worker');

  const connection = await NativeConnection.connect({
    address: config.temporal.address,
  });

  logger.info('Connected to Temporal server');

  const s3Client = createS3Client({
    region: config.aws.region,
    endpoint: config.aws.s3Endpoint || undefined,
    forcePathStyle: config.aws.s3ForcePathStyle,
  });

  const storage = new Storage(s3Client);

  logger.info('Storage initialized');

  const activities = {
    runTypescriptAlgorithm: dispatchAlgorithm(storage),
  };

  logger.info(`Activities initialized: [${Object.keys(activities).join(', ')}]`);

  const worker = await Worker.create({
    connection,
    namespace: config.temporal.namespace,
    taskQueue: config.temporal.algorithmTypescriptTaskQueue,
    maxConcurrentActivityTaskExecutions: TYPESCRIPT_ALGORITHM_WORKER_MAX_CONCURRENT_ACTIVITIES,
    activities,
  });

  logger.info('Worker created successfully');

  const shutdown = async () => {
    logger.info('Shutting down algorithm worker...');

    try {
      try {
        await worker.shutdown();
      } catch (shutdownErr) {
        const msg = shutdownErr instanceof Error ? shutdownErr.message : String(shutdownErr);
        if (msg.includes('STOPPED') || msg.includes('Not running')) {
          logger.info('Worker already stopped');
        } else {
          throw shutdownErr;
        }
      }
      logger.info('Worker shutdown initiated');

      logger.info('Worker shut down successfully');
      process.exit(0);
    } catch (error) {
      const err = error as Error;
      logger.error({ error: err.message }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('Worker is running and polling for tasks');

  await worker.run();
}

run().catch((error) => {
  logger.error({ err: error }, 'Fatal error starting algorithm worker');
  process.exit(1);
});
