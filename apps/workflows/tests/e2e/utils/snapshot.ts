import type { SnapshotDto } from '@reputo/contracts';

export interface BuildSnapshotParams {
  /** Snapshot id — also the storage-key prefix (`snapshots/<id>/...`). */
  id?: string;
  /** Frozen algorithm key, e.g. 'voting_engagement'. */
  key: string;
  /** Frozen algorithm version (defaults to '1.0.0'). */
  version?: string;
  /** Frozen preset inputs: scalar params, arrays, or storage-key strings. */
  inputs: Array<{ key: string; value?: unknown }>;
  /**
   * Snapshot creation time. Only token_value_over_time reads it (as the scoring
   * "now"); for other algorithms it is irrelevant. ISO 8601 string.
   */
  createdAt?: string;
}

/**
 * Builds a fully-typed `SnapshotDto` the way the API's `getSnapshot` activity
 * would hand one to a worker. A compute function only reads `id`,
 * `algorithmPresetFrozen.{key,version,inputs}` and (token-value) `createdAt`; the
 * remaining fields are filler that satisfy the type.
 */
export function buildSnapshot(params: BuildSnapshotParams): SnapshotDto {
  const timestamp = params.createdAt ?? '2026-01-01T00:00:00.000Z';
  return {
    id: params.id ?? 'snap-e2e',
    status: 'running',
    algorithmPresetId: 'preset-e2e',
    algorithmPresetFrozen: {
      key: params.key,
      version: params.version ?? '1.0.0',
      inputs: params.inputs,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
