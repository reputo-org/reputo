import type { CommunityConnectionDto } from '../community/community-connection.dto.js';
import type { SnapshotPublicationStatus } from '../enums/snapshot-publication.js';
import type { SnapshotStatus } from '../enums/snapshot-status.js';
import type { SnapshotDto, SnapshotError, SnapshotOutputs, SnapshotTemporalInfo } from '../snapshot/snapshot.dto.js';
import type { SnapshotPublicationCounts } from '../snapshot/snapshot-publication.dto.js';

/**
 * `ApplicationFailure.type` thrown (non-retryable) by the API snapshot
 * activities when the snapshot row no longer exists. Shared so workflow code
 * can recognize a deleted snapshot without matching on message text.
 */
export const SNAPSHOT_NOT_FOUND_ERROR_TYPE = 'SnapshotNotFoundError' as const;

/**
 * `ApplicationFailure.type` thrown (non-retryable) by `getCommunityConnection`
 * when the referenced connection no longer exists.
 */
export const COMMUNITY_CONNECTION_NOT_FOUND_ERROR_TYPE = 'CommunityConnectionNotFoundError' as const;

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

export interface GetCommunityConnectionInput {
  connectionId: string;
}

/**
 * Input to the `recordSnapshotPublication` activity. Upsert semantics on
 * `(snapshotId, algorithmKey)`, so an activity retry rewrites the same row.
 * `error` must be a safe category or summary — never a DeepID response body.
 */
export interface RecordSnapshotPublicationInput {
  snapshotId: string;
  algorithmKey: string;
  status: SnapshotPublicationStatus;
  counts?: SnapshotPublicationCounts;
  error?: string;
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
  /**
   * Reads connection metadata for a community snapshot run — the workers have
   * no application-database access. Never returns credential material.
   */
  getCommunityConnection(input: GetCommunityConnectionInput): Promise<CommunityConnectionDto>;
  recordSnapshotPublication(input: RecordSnapshotPublicationInput): Promise<void>;
}
