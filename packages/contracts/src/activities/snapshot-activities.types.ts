import type { SnapshotStatus } from '../enums/snapshot-status.js';
import type { SnapshotDto, SnapshotError, SnapshotOutputs, SnapshotTemporalInfo } from '../snapshot/snapshot.dto.js';

export interface GetSnapshotInput {
  snapshotId: string;
}

/**
 * Input to the `updateSnapshot` activity.
 *
 * No `seq` field: Temporal records activity completion in workflow history
 * and replays deterministically, so we do not need workflow-side
 * de-duplication. Activity bodies must still be idempotent under retry
 * (overwrite semantics — re-applying the same payload yields the same row).
 */
export interface UpdateSnapshotInput {
  snapshotId: string;
  status?: SnapshotStatus;
  temporal?: SnapshotTemporalInfo;
  outputs?: SnapshotOutputs;
  error?: Omit<SnapshotError, 'timestamp'> & { message: string };
}

/**
 * The set of activities the Reputo API exposes for the snapshot lifecycle.
 *
 * Workflow code uses this interface as the type parameter to
 * `workflow.proxyActivities<ApiSnapshotActivities>({ taskQueue: ... })`. The
 * API's activity worker registers implementations whose function names match
 * the keys of this interface.
 *
 * Missing snapshots surface as a non-retryable `ApplicationFailure` of type
 * `SnapshotNotFoundError` thrown from the activity. Workflows that need to
 * handle that case explicitly should catch `ApplicationFailure`.
 */
export interface ApiSnapshotActivities {
  getSnapshot(input: GetSnapshotInput): Promise<SnapshotDto>;
  updateSnapshot(input: UpdateSnapshotInput): Promise<void>;
}
