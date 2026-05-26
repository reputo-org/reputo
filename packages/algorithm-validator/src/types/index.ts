export type {
  AlgorithmCategory,
  AlgorithmDefinition,
  AlgorithmKind,
  AlgorithmRuntime,
  AlgorithmValidationConfig,
  AlgorithmValidationRule,
  ArrayIoItem,
  ArrayObjectPropertyParam,
  CsvIoItem,
  IoItem,
  IoType,
  JsonChainCoverageValidationRule,
  JsonIoItem,
  ObjectPropertyParam,
  ResourceCatalog,
  ResourceCatalogChain,
  ResourceCatalogResource,
  ScalarObjectPropertyParam,
  SubAlgorithmIoItem,
} from './algorithm.js';

export interface ValidationResult {
  success: boolean;
  data?: unknown;
  errors?: Array<{
    field: string;
    message: string;
    /** Zod error code (e.g., 'too_small', 'invalid_type') */
    code?: string;
  }>;
}

export interface FileValidationResult {
  valid: boolean;
  errors: string[];
}

export interface CSVValidationResult extends FileValidationResult {}

export interface JSONValidationResult extends FileValidationResult {}

export interface AlgorithmPresetValidationResult {
  success: boolean;
  data?: {
    preset: unknown;
    payload: Record<string, unknown>;
  };
  errors?: Array<{
    field: string;
    message: string;
    source: 'preset' | 'definition' | 'payload' | 'file' | 'rule';
    code?: string;
  }>;
}
