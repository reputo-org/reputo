import * as workflow from '@temporalio/workflow';
import { communityTaskQueue } from '../../../../src/shared/constants/task-queues.js';

interface ProbeActivities {
  probeCommunityFetch(input: { label: string }): Promise<void>;
}

/** Schedules one probe activity on the community queue, like a snapshot's fetch. */
export async function CommunityQueueProbeWorkflow(input: { label: string }): Promise<void> {
  const { probeCommunityFetch } = workflow.proxyActivities<ProbeActivities>({
    taskQueue: communityTaskQueue,
    startToCloseTimeout: '1 minute',
  });
  await probeCommunityFetch(input);
}
