import type { SnapshotPublicationStatus } from '../enums/snapshot-publication.js';

/**
 * Row counts reported by one DeepID posting pass. `dropped` counts DeepID's
 * expected "User not found" rejections (no consent); `skipped` counts CSV rows
 * that never left Reputo (invalid DID or non-finite score).
 */
export interface SnapshotPublicationCounts {
  posted: number;
  ok: number;
  failed: number;
  dropped: number;
  skipped: number;
}

/**
 * Wire DTO for one snapshot's publication record. JSON-serializable; dates are
 * ISO 8601 strings. `error` is a safe category or summary sentence — never a
 * DeepID response body.
 */
export interface SnapshotPublicationDto {
  algorithmKey: string;
  status: SnapshotPublicationStatus;
  counts?: SnapshotPublicationCounts;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
