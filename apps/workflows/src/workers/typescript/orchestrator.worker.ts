import { createRequire } from 'node:module';
import { createS3Client, Storage } from '@reputo/storage';
import { NativeConnection, Worker } from '@temporalio/worker';
import {
  createAlgorithmLibraryActivities,
  createOrchestratorDependencyResolverActivities,
} from '../../activities/orchestrator/index.js';
import config from '../../config/index.js';
import {
  ORCHESTRATOR_WORKER_MAX_CONCURRENT_ACTIVITIES,
  ORCHESTRATOR_WORKER_MAX_CONCURRENT_WORKFLOWS,
} from '../../shared/constants/index.js';
import { logger } from '../../shared/utils/index.js';

const require = createRequire(import.meta.url);

async function run(): Promise<void> {
  logger.info('Starting Orchestrator Worker');

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

  const worker = await Worker.create({
    connection,
    namespace: config.temporal.namespace,
    taskQueue: config.temporal.orchestratorTaskQueue,
    maxConcurrentWorkflowTaskExecutions: ORCHESTRATOR_WORKER_MAX_CONCURRENT_WORKFLOWS,
    maxConcurrentActivityTaskExecutions: ORCHESTRATOR_WORKER_MAX_CONCURRENT_ACTIVITIES,

    workflowsPath: require.resolve('../../workflows/orchestrator.workflow'),
    activities: {
      ...createAlgorithmLibraryActivities(),
      ...createOrchestratorDependencyResolverActivities({
        storage,
        storageConfig,
      }),
    },
    bundlerOptions: {
      ignoreModules: ['fs', 'path', 'os', 'crypto'],
    },
  });

  logger.info('Worker created successfully');

  const shutdown = async () => {
    logger.info('Shutting down orchestrator worker...');

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

  logger.info({ taskQueue: config.temporal.orchestratorTaskQueue }, 'Worker is running and polling for tasks');

  await worker.run();
}

run().catch((error) => {
  logger.error({ err: error }, 'Fatal error starting orchestrator worker');
  process.exit(1);
});
