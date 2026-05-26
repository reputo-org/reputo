import { registerAs } from '@nestjs/config';

import { env } from './env';

export default registerAs('temporal', () => ({
  address: env.TEMPORAL_ADDRESS,
  namespace: env.TEMPORAL_NAMESPACE,
  orchestratorTaskQueue: env.TEMPORAL_ORCHESTRATOR_TASK_QUEUE,
  apiSnapshotActivitiesTaskQueue: env.TEMPORAL_API_SNAPSHOT_ACTIVITIES_TASK_QUEUE,
}));
