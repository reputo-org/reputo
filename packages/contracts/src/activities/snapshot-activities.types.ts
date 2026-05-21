import type { SnapshotStatus } from '../enums/snapshot-status.js';
import type { SnapshotDto, SnapshotError, SnapshotOutputs, SnapshotTemporalInfo } from '../snapshot/snapshot.dto.js';

/**
 * Input to the `getSnapshot` activity.
 */
export interface GetSnapshotInput {
  snapshotId: string;
}

/**
 * Output of the `getSnapshot` activity.
 *
 * Envelope-shaped so workflow code can distinguish "not found" from a thrown
 * error without serializing exceptions across the activity boundary.
 */
export type GetSnapshotOutput =
  | { ok: true; snapshot: SnapshotDto }
  | { ok: false; error: { code: 'NOT_FOUND'; message: string } };

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
 */
export interface ApiSnapshotActivities {
  getSnapshot(input: GetSnapshotInput): Promise<GetSnapshotOutput>;
  updateSnapshot(input: UpdateSnapshotInput): Promise<void>;
}
