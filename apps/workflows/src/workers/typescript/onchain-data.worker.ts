import { pathToFileURL } from 'node:url';
import { NativeConnection, Worker } from '@temporalio/worker';

import { createOnchainDataDependencyResolverActivities } from '../../activities/onchain-data/index.js';
import config from '../../config/index.js';
import { ONCHAIN_DATA_WORKER_MAX_CONCURRENT_ACTIVITIES } from '../../shared/constants/index.js';
import { logger } from '../../shared/utils/index.js';

export async function runOnchainDataWorker(): Promise<void> {
  logger.info('Starting Onchain Data Worker');

  const connection = await NativeConnection.connect({
    address: config.temporal.address,
  });

  logger.info('Connected to Temporal server');

  const activities = createOnchainDataDependencyResolverActivities({
    databaseUrl: config.onchainData.uri,
    alchemyApiKey: config.onchainData.alchemyApiKey,
    blockfrostAPIKey: config.onchainData.blockfrostAPIKey,
  });

  logger.info(`Activities initialized: [${Object.keys(activities).join(', ')}]`);

  const worker = await Worker.create({
    connection,
    namespace: config.temporal.namespace,
    taskQueue: config.temporal.onchainDataTaskQueue,
    maxConcurrentActivityTaskExecutions: ONCHAIN_DATA_WORKER_MAX_CONCURRENT_ACTIVITIES,
    activities,
  });

  logger.info('Worker created successfully');

  const shutdown = async () => {
    logger.info('Shutting down onchain data worker...');

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

  logger.info({ taskQueue: config.temporal.onchainDataTaskQueue }, 'Worker is running and polling for tasks');

  await worker.run();
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOnchainDataWorker().catch((error) => {
    logger.error({ err: error }, 'Fatal error starting onchain data worker');
    process.exit(1);
  });
}
