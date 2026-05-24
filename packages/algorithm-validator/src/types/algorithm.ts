export type AlgorithmCategory = 'Engagement' | 'Quality' | 'Activity' | 'Custom';

export type IoType =
  | 'csv'
  | 'json'
  | 'number'
  | 'boolean'
  | 'array'
  | 'score_map'
  | 'string'
  | 'sub_algorithm'
  | 'object'
  | (string & {});

export type AlgorithmKind = 'standalone' | 'combined';

interface BaseIoItem {
  key: string;
  label?: string;
  description?: string;
}

export interface CsvIoItem extends BaseIoItem {
  type: 'csv';
  csv: {
    hasHeader?: boolean;
    /** Character used to separate values (default: comma) */
    delimiter?: string;
    maxRows?: number;
    maxBytes?: number;
    columns: Array<{
      key: string;
      type: 'string' | 'integer' | 'number' | 'date' | 'enum' | (string & {});
      required?: boolean;
      /** Valid values for enum-type columns */
      enum?: Array<string | number>;
      aliases?: string[];
      description?: string;
    }>;
  };
  /** Entity type that this CSV data represents (e.g., 'user', 'post', 'comment') */
  entity?: string;
}

/**
 * For server execution, JSON outputs are typically stored as a JSON file in storage (e.g. S3 key).
 */
export interface JsonIoItem extends BaseIoItem {
  type: 'json';
  required?: boolean;
  json?: {
    maxBytes?: number;
    /** Named validation shape applied to the JSON content */
    schema?: string;
    /** Required root key for object-shaped JSON inputs */
    rootKey?: string;
    /** Allowed chain keys for wallet-address map inputs */
    allowedChains?: string[];
  };
  entity?: string;
}

export interface NumericIoItem extends BaseIoItem {
  type: 'number' | 'integer';
  min?: number;
  max?: number;
  default?: number;
  step?: number;
  required?: boolean;
  uiHint?: {
    widget?: 'slider' | 'input' | string;
  };
}

export interface BooleanIoItem extends BaseIoItem {
  type: 'boolean';
  default?: boolean;
  required?: boolean;
}

export interface StringIoItem extends BaseIoItem {
  type: 'string';
  default?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  enum?: string[];
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

export interface ResourceCatalog {
  chains: ResourceCatalogChain[];
}

export interface ResourceCatalogChain {
  key: string;
  label: string;
  resources: ResourceCatalogResource[];
}

export interface ResourceCatalogResource {
  key: string;
  label: string;
  description?: string;
  kind: 'token' | 'contract';
  identifier: string;
  tokenIdentifier: string;
  tokenKey: string;
  parentResourceKey?: string;
  explorerUrl?: string;
  explorerLabel?: string;
  iconUrl?: string;
}

interface BaseObjectPropertyParam {
  key: string;
  label?: string;
  description?: string;
  required?: boolean;
}

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

export type ObjectPropertyParam = ScalarObjectPropertyParam | ArrayObjectPropertyParam;

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

export type AlgorithmValidationRule = JsonChainCoverageValidationRule;

export interface AlgorithmValidationConfig {
  rules: AlgorithmValidationRule[];
}

export type AlgorithmRuntime = 'typescript' | 'python';

export interface AlgorithmDefinition {
  key: string;
  name: string;
  kind?: AlgorithmKind;
  category: AlgorithmCategory;
  summary: string;
  description: string;
  version: string;
  inputs: IoItem[];
  outputs: IoItem[];
  runtime: AlgorithmRuntime;
  dependencies?: Array<{ key: string }>;
  validation?: AlgorithmValidationConfig;
}
