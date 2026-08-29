import { pathToFileURL } from 'node:url';
import { createS3Client, Storage } from '@reputo/storage';
import { NativeConnection, Worker } from '@temporalio/worker';

import { createCommunityDependencyResolverActivities } from '../../activities/community/index.js';
import config from '../../config/index.js';
import { COMMUNITY_WORKER_MAX_CONCURRENT_ACTIVITIES } from '../../shared/constants/index.js';
import { logger } from '../../shared/utils/index.js';

export async function runCommunityWorker(): Promise<void> {
  logger.info('Starting Community Worker');

  const connection = await NativeConnection.connect({
    address: config.temporal.address,
  });

  logger.info('Connected to Temporal server');

  const s3Client = createS3Client({
    region: config.aws.region,
    endpoint: config.storage.endpoint,
    forcePathStyle: config.storage.forcePathStyle,
  });
  const storage = new Storage(s3Client);
  const storageConfig = {
    bucket: config.storage.bucket,
    maxSizeBytes: config.storage.maxSizeBytes,
  };

  const activities = createCommunityDependencyResolverActivities({ storage, storageConfig });

  logger.info(`Activities initialized: [${Object.keys(activities).join(', ')}]`);

  const worker = await Worker.create({
    connection,
    namespace: config.temporal.namespace,
    taskQueue: config.temporal.communityTaskQueue,
    // One fetch at a time is the doc's "one community snapshot runs at a
    // time"; queued snapshots wait and run in arrival order.
    maxConcurrentActivityTaskExecutions: COMMUNITY_WORKER_MAX_CONCURRENT_ACTIVITIES,
    activities,
  });

  logger.info('Worker created successfully');

  const shutdown = async () => {
    logger.info('Shutting down community worker...');

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

  logger.info({ taskQueue: config.temporal.communityTaskQueue }, 'Worker is running and polling for tasks');

  await worker.run();
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCommunityWorker().catch((error) => {
    logger.error({ err: error }, 'Fatal error starting community worker');
    process.exit(1);
  });
}
