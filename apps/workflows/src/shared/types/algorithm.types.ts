export interface StorageConfig {
  bucket: string;
  maxSizeBytes: number;
}

export interface AlgorithmResult {
  /**
   * Algorithm outputs, mapping logical output keys to storage keys or inline values.
   * Keys must match AlgorithmDefinition.outputs[].key.
   */
  outputs: Record<string, unknown>;
}
