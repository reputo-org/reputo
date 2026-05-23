/**
 * Lifecycle states of a snapshot as observed across the API/Workflows boundary.
 * The string values are the canonical wire form.
 */
export const SnapshotStatus = {
  queued: 'queued',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
} as const;

export type SnapshotStatus = (typeof SnapshotStatus)[keyof typeof SnapshotStatus];

export const SNAPSHOT_STATUS = Object.values(SnapshotStatus);
