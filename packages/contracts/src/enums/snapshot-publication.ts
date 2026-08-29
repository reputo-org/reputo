/**
 * Lifecycle of one snapshot's score publication to DeepID. A row is `pending`
 * from just before the posting activity starts, `sent` once the activity
 * finished a pass (per-row rejections are recorded in the counts), and
 * `failed` when the activity exhausted its retries without completing.
 */
export const SnapshotPublicationStatus = {
  pending: 'pending',
  sent: 'sent',
  failed: 'failed',
} as const;

export type SnapshotPublicationStatus = (typeof SnapshotPublicationStatus)[keyof typeof SnapshotPublicationStatus];

export const SNAPSHOT_PUBLICATION_STATUSES = Object.values(SnapshotPublicationStatus);
