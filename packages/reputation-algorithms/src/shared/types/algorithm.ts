/**
 * Supported algorithm categories for organizing reputation algorithms.
 */
export type AlgorithmCategory =
  | 'Engagement' // Algorithms focused on user engagement metrics
  | 'Quality' // Algorithms measuring content or user quality
  | 'Activity' // Algorithms tracking user activity patterns
  | 'Custom'; // Custom or specialized algorithms

/**
 * Supported algorithm definition kinds.
 */
export type AlgorithmKind =
  | 'standalone' // A single algorithm with its own direct inputs
  | 'combined'; // A composed algorithm built from sub-algorithms

/**
 * Supported input/output types for algorithm definitions.
 */
export type IoType =
  | 'csv' // Comma-separated values data
  | 'json' // JSON data or files
  | 'number' // Numeric values
  | 'boolean' // True/false values
  | 'array' // Array of values
  | 'score_map' // Mapping of scores to entities
  | 'string' // Text values
  | 'sub_algorithm' // Nested algorithm definitions selected at runtime
  | 'object' // Complex object structures
  | (string & {}); // Allow additional string literals

/**
 * Base interface for all input/output items in algorithm definitions.
 */
interface BaseIoItem {
  /** Unique identifier for the I/O item */
  key: string;
  /** Human-readable label for display purposes */
  label?: string;
  /** Detailed description of the I/O item's purpose and usage */
  description?: string;
}

/**
 * CSV input/output item configuration for algorithm definitions.
 */
export interface CsvIoItem extends BaseIoItem {
  /** Type identifier for CSV data */
  type: 'csv';
  /** CSV parsing and validation configuration */
  csv: {
    /** Whether the CSV file includes a header row */
    hasHeader?: boolean;
    /** Character used to separate values (default: comma) */
    delimiter?: string;
    /** Maximum number of rows to process */
    maxRows?: number;
    /** Maximum file size in bytes */
    maxBytes?: number;
    /** Column definitions for data validation and processing */
    columns: Array<{
      /** Unique identifier for the column */
      key: string;
      /** Data type expected in this column */
      type:
        | 'string' // Text data
        | 'integer' // Whole numbers
        | 'number' // Decimal numbers
        | 'date' // Date/time values
        | 'enum' // Predefined values
        | (string & {}); // Allow additional types
      /** Whether this column is required for processing */
      required?: boolean;
      /** Valid values for enum-type columns */
      enum?: Array<string | number>;
      /** Alternative names that can be used for this column */
      aliases?: string[];
      /** Description of the column's purpose and expected data */
      description?: string;
    }>;
  };
  /** Entity type that this CSV data represents (e.g., 'user', 'post', 'comment') */
  entity?: string;
}

/**
 * JSON input/output item configuration for algorithm definitions.
 */
export interface JsonIoItem extends BaseIoItem {
  /** Type identifier for JSON data */
  type: 'json';
  /** Whether this input is required */
  required?: boolean;
  /** Optional JSON validation metadata for file-backed JSON inputs */
  json?: {
    /** Maximum file size in bytes */
    maxBytes?: number;
    /** Named validation shape applied to the JSON content */
    schema?: string;
    /** Required root key for object-shaped JSON inputs */
    rootKey?: string;
    /** Allowed chain keys for wallet-address map inputs */
    allowedChains?: string[];
  };
  /** Entity type that this JSON data represents */
  entity?: string;
}

/**
 * Numeric input item configuration for algorithm definitions.
 */
export interface NumericIoItem extends BaseIoItem {
  /** Type identifier for numeric data */
  type: 'number' | 'integer';
  /** Minimum allowed value */
  min?: number;
  /** Maximum allowed value */
  max?: number;
  /** Default value */
  default?: number;
  /** Step increment for the input */
  step?: number;
  /** Whether this input is required */
  required?: boolean;
  /** UI rendering hints */
  uiHint?: {
    /** Widget type for rendering (e.g., 'slider', 'input') */
    widget?: 'slider' | 'input' | string;
  };
}

/**
 * Boolean input item configuration for algorithm definitions.
 */
export interface BooleanIoItem extends BaseIoItem {
  /** Type identifier for boolean data */
  type: 'boolean';
  /** Default value */
  default?: boolean;
  /** Whether this input is required */
  required?: boolean;
}

/**
 * String input item configuration for algorithm definitions.
 */
export interface StringIoItem extends BaseIoItem {
  /** Type identifier for string data */
  type: 'string';
  /** Default value */
  default?: string;
  /** Whether this input is required */
  required?: boolean;
  /** Minimum length for the string */
  minLength?: number;
  /** Maximum length for the string */
  maxLength?: number;
  /** Allowed values (enum constraint) */
  enum?: string[];
  /** UI rendering hints */
  uiHint?: {
    widget?: 'select' | string;
    options?: Array<{
      value: string;
      label: string;
      filterBy?: string;
      filters?: Record<string, string>;
    }>;
    dependsOn?: string | string[];
  };
}

/**
 * Catalog of chain-scoped resources available to a resource selector input.
 */
export interface ResourceCatalog {
  chains: ResourceCatalogChain[];
}

/**
 * Resource catalog entry for a single chain.
 */
export interface ResourceCatalogChain {
  key: string;
  label: string;
  resources: ResourceCatalogResource[];
}

/**
 * Selectable resource entry for a chain within a resource selector input.
 */
export interface ResourceCatalogResource {
  key: string;
  label: string;
  description?: string;
  kind: 'token' | 'contract';
  identifier: string;
  tokenIdentifier: string;
  tokenKey: string;
  /** Decimals to convert raw on-chain quantities into token units (Cardano native assets). */
  tokenDecimals?: number;
  parentResourceKey?: string;
  explorerUrl?: string;
  explorerLabel?: string;
  iconUrl?: string;
}

/**
 * Shared fields for object property definitions inside array item schemas.
 */
interface BaseObjectPropertyParam {
  key: string;
  label?: string;
  description?: string;
  required?: boolean;
}

/**
 * Scalar property definition inside an array item's object schema.
 */
export interface ScalarObjectPropertyParam extends BaseObjectPropertyParam {
  type: 'string' | 'integer' | 'number';
  enum?: string[];
  default?: string | number;
  uiHint?: {
    widget?: 'select' | string;
    options?: Array<{
      value: string;
      label: string;
      filterBy?: string;
      filters?: Record<string, string>;
    }>;
    dependsOn?: string | string[];
  };
}

/**
 * Nested array property definition inside an array item's object schema.
 */
export interface ArrayObjectPropertyParam extends BaseObjectPropertyParam {
  type: 'array';
  minItems?: number;
  uniqueBy?: string[];
  uiHint?: {
    widget?: 'repeater' | string;
    addButtonLabel?: string;
    dependsOn?: string | string[];
  };
  item: {
    type: 'object';
    properties: ObjectPropertyParam[];
  };
}

/**
 * Property definition inside an array item's object schema.
 */
export type ObjectPropertyParam = ScalarObjectPropertyParam | ArrayObjectPropertyParam;

/**
 * Array input item configuration for algorithm definitions.
 * Represents arrays of objects with nested properties.
 */
export interface ArrayIoItem extends BaseIoItem {
  type: 'array';
  minItems?: number;
  required?: boolean;
  /** Keys that must be unique across all array rows when combined together. */
  uniqueBy?: string[];
  uiHint?: {
    widget?: 'repeater' | 'resource_selector' | string;
    addButtonLabel?: string;
    presets?: Array<{ label: string; value: Array<Record<string, unknown>> }>;
    dependsOn?: string | string[];
    resourceCatalog?: ResourceCatalog;
  };
  item: {
    type: 'object';
    properties: ObjectPropertyParam[];
  };
}

/**
 * Sub-algorithm composer input for combined algorithm definitions.
 */
export interface SubAlgorithmIoItem extends BaseIoItem {
  type: 'sub_algorithm';
  required: boolean;
  minItems?: number;
  maxItems?: number;
  sharedInputKeys?: string[];
  uiHint?: {
    widget: 'sub_algorithm_composer';
    addButtonLabel?: string;
  };
}

/**
 * Union type for all supported input/output item types.
 */
export type IoItem =
  | CsvIoItem
  | JsonIoItem
  | NumericIoItem
  | BooleanIoItem
  | StringIoItem
  | ArrayIoItem
  | SubAlgorithmIoItem;

/**
 * Root-level validation rule that uses a wallet JSON input to validate
 * chain coverage for a selector input.
 */
export interface JsonChainCoverageValidationRule {
  kind: 'json_chain_coverage';
  walletInputKey: string;
  selectorInputKey: string;
  selectorChainField: string;
}

/**
 * Supported root-level validation rules for algorithm definitions.
 */
export type AlgorithmValidationRule = JsonChainCoverageValidationRule;

/**
 * Additional validation metadata attached to an algorithm definition.
 */
export interface AlgorithmValidationConfig {
  rules: AlgorithmValidationRule[];
}

/**
 * Supported runtimes (languages) for algorithm execution.
 *
 * Orchestration layers use this field to route algorithm activities to the correct language-specific worker.
 */
export type AlgorithmRuntime = 'typescript' | 'python';

/**
 * Describes an external dependency that an algorithm requires.
 * Dependencies are resolved before algorithm execution.
 * Algorithms fetch the data using predictable S3 key patterns.
 */
export interface AlgorithmDependency {
  /** Unique identifier for the dependency (e.g., 'deepfunding-portal-api') */
  key: string;
}

/**
 * Complete algorithm definition structure.
 */
export interface AlgorithmDefinition {
  /** Unique identifier for the algorithm */
  key: string;
  /** Human-readable name of the algorithm */
  name: string;
  /** Optional algorithm composition kind */
  kind?: AlgorithmKind;
  /** Category classification for organizing algorithms */
  category: AlgorithmCategory;
  /** Short summary of the algorithm for card displays */
  summary: string;
  /** Detailed description of what the algorithm does and how it works */
  description: string;
  /** Semantic version of the algorithm definition */
  version: string;
  /** Array of input data specifications */
  inputs: IoItem[];
  /** Array of output data specifications */
  outputs: IoItem[];
  /** Runtime (language) used for execution routing */
  runtime: AlgorithmRuntime;
  /** Optional array of external dependencies required by this algorithm */
  dependencies?: AlgorithmDependency[];
  /** Optional root-level validation rules enforced by the shared validator */
  validation?: AlgorithmValidationConfig;
}

/**
 * Filters for searching algorithm definitions by metadata.
 */
export interface SearchAlgorithmFilters {
  /**
   * Algorithm key to search for.
   * Supports exact and partial (substring) matching, case-insensitive.
   */
  key?: string;

  /**
   * Human-readable algorithm name to search for.
   * Supports exact and partial (substring) matching, case-insensitive.
   */
  name?: string;

  /**
   * Algorithm category to search for.
   * Supports exact and partial (substring) matching, case-insensitive.
   */
  category?: string;
}
