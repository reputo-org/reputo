export const DB_ACTIVITY_TIMEOUT = '1 minute';
export const ALGORITHM_LIBRARY_TIMEOUT = '30 seconds';
export const ALGORITHM_EXECUTION_TIMEOUT = '10 minutes';
export const DEEPFUNDING_SYNC_TIMEOUT = '30 minutes';
export const DEPENDENCY_RESOLUTION_TIMEOUT = '30 minutes';
export const ONCHAIN_DATA_DEPENDENCY_RESOLUTION_TIMEOUT = '2 hours';
export const DEEP_ID_POST_SCORES_TIMEOUT = '15 minutes';
export const DEEP_ID_POST_SCORES_HEARTBEAT_TIMEOUT = '5 minutes';
// Covers one readiness pass (bounded by DeepID's 5-minute cursor lifetime) plus its cursor restarts.
export const DEEP_ID_READINESS_CHECK_TIMEOUT = '30 minutes';
// Covers one full encrypted processing pass — paginated reads, CKKS evaluation,
// and bounded final posts — plus its cursor restarts.
export const DEEP_ID_ENCRYPTED_SUBMISSION_TIMEOUT = '2 hours';
export const DEEP_ID_READINESS_POLL_DELAYS_MS: readonly number[] = [60_000, 15 * 60_000, 60 * 60_000];
export const DEEP_ID_READINESS_STEADY_POLL_DELAY_MS = 60 * 60_000;
export const DEEP_ID_ENCRYPTION_DEADLINE_MS = 24 * 60 * 60_000;
// Kept in sync with the enforcing copy in apps/api/src/shared/constants/temporal.constants.ts.
export const WORKFLOW_RUN_TIMEOUT = '30 hours';
export const HEARTBEAT_TIMEOUT = '2 minutes';
export const ACTIVITY_MAX_ATTEMPTS = 3;
export const HEARTBEAT_INTERVAL = 100;
export const ORCHESTRATOR_WORKER_MAX_CONCURRENT_WORKFLOWS = 5;
export const ORCHESTRATOR_WORKER_MAX_CONCURRENT_ACTIVITIES = 5;
export const TYPESCRIPT_ALGORITHM_WORKER_MAX_CONCURRENT_ACTIVITIES = 5;
export const ONCHAIN_DATA_WORKER_MAX_CONCURRENT_ACTIVITIES = 1;
