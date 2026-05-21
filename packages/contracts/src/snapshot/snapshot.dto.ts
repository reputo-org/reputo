import type { SnapshotStatus } from '../enums/snapshot-status.js';
import type { AlgorithmPresetFrozenDto } from './algorithm-preset-frozen.dto.js';

/**
 * Algorithm execution outputs/results.
 * Keys are algorithm-specific (e.g. 'voting_engagement', 'csv').
 * Values are typically storage location references.
 */
export interface SnapshotOutputs {
  [key: string]: string | undefined;
}

/**
 * Error information captured when a snapshot execution fails.
 */
export interface SnapshotError {
  message: string;
  timestamp?: string;
  [key: string]: unknown;
}

/**
 * Temporal workflow coordinates attached to a snapshot.
 */
export interface SnapshotTemporalInfo {
  workflowId?: string;
  runId?: string;
  taskQueue?: string;
  algorithmTaskQueue?: string;
}

/**
 * Wire DTO for a Snapshot. JSON-serializable. Returned by the `getSnapshot`
 * Temporal activity and embedded inside `UpdateSnapshotInput` shape decisions.
 *
 * `id` is a UUID v7 string. Dates are ISO 8601 strings so the value round-trips
 * cleanly through Temporal's default JSON data converter.
 */
export interface SnapshotDto {
  id: string;
  status: SnapshotStatus;
  algorithmPresetId: string;
  algorithmPresetFrozen: AlgorithmPresetFrozenDto;
  temporal?: SnapshotTemporalInfo;
  outputs?: SnapshotOutputs;
  error?: SnapshotError;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}
