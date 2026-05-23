/**
 * Immutable snapshot of an AlgorithmPreset captured at snapshot creation time.
 * JSON-serializable; safe to transport across Temporal activity boundaries.
 */
export interface AlgorithmPresetFrozenDto {
  key: string;
  version: string;
  inputs: Array<{
    key: string;
    value?: unknown;
  }>;
  name?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
}
