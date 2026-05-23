/**
 * Temporal task-queue names hosted by the Reputo API.
 *
 * Constants are framework-agnostic strings. The API registers its activity
 * worker against these queues; the orchestrator workflow proxies activities
 * to them via `workflow.proxyActivities({ taskQueue: ... })`.
 *
 * Renaming a value is a coordinated deploy — both sides must redeploy together.
 */
export const API_SNAPSHOT_ACTIVITIES_TASK_QUEUE = 'api-snapshot-activities' as const;
export type ApiSnapshotActivitiesTaskQueue = typeof API_SNAPSHOT_ACTIVITIES_TASK_QUEUE;
