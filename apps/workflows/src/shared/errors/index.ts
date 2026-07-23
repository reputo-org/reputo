/** Temporal failure type for the 24-hour encryption-readiness deadline. */
export const DEEP_ID_ENCRYPTION_TIMEOUT_ERROR_TYPE = 'DEEPID_ENCRYPTION_TIMEOUT';

/** Temporal failure type for fatal, non-retryable readiness-pass errors. */
export const DEEP_ID_ENCRYPTION_READINESS_FATAL_ERROR_TYPE = 'DEEPID_ENCRYPTION_READINESS_FATAL';

export class WorkflowError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}

/** Failure categories of the encrypted custom-score evaluator boundary. */
export const ENCRYPTED_CUSTOM_SCORE_ERROR_CODES = [
  /** The requested normalization method has no registered encrypted strategy. */
  'UNSUPPORTED_NORMALIZATION_METHOD',
  /** A child's normalization observation is malformed for the active method. */
  'INVALID_NORMALIZATION_INPUT',
  /** A child weight is non-finite or not greater than zero, or the total weight is non-finite. */
  'INVALID_WEIGHT',
  /** No configured child weight is greater than zero. */
  'ALL_ZERO_WEIGHTS',
  /** The selected child set is empty or contains duplicate keys. */
  'INVALID_CHILDREN',
  /** SEAL metadata is missing, malformed, or contradicts its own parameters. */
  'INCOMPATIBLE_METADATA',
  /** The user references a metadata key that was never registered. */
  'UNREGISTERED_KEY',
  /** The user's selected ciphertext set is not exactly the configured child set. */
  'INCOMPLETE_CIPHERTEXT_SET',
  /** A ciphertext is corrupt, from other parameters, or at an unusable scale. */
  'INCOMPATIBLE_CIPHERTEXT',
  /** Ciphertext levels or scales cannot be aligned for evaluation. */
  'IMPOSSIBLE_ALIGNMENT',
  /** Observed bounds or derived coefficients exceed what the CKKS parameters can represent. */
  'CAPACITY_EXCEEDED',
  /** More users were passed to one evaluation batch than the bounded limit. */
  'BATCH_LIMIT_EXCEEDED',
  /** The evaluator was used after `dispose()`. */
  'EVALUATOR_DISPOSED',
  /** An unexpected SEAL/WASM failure that matches no specific category. */
  'EVALUATION_FAILED',
] as const;

export type EncryptedCustomScoreErrorCode = (typeof ENCRYPTED_CUSTOM_SCORE_ERROR_CODES)[number];

/**
 * Typed contract error of the encrypted custom-score evaluator. Messages and
 * context never carry plaintext scores, ciphertext bodies, or key material.
 */
export class EncryptedCustomScoreError extends WorkflowError {
  constructor(
    message: string,
    public readonly evaluationCode: EncryptedCustomScoreErrorCode,
    context?: Record<string, unknown>,
  ) {
    super(message, evaluationCode, context);
    this.name = 'EncryptedCustomScoreError';
  }
}

export class SnapshotNotFoundError extends WorkflowError {
  constructor(snapshotId: string) {
    super(`Snapshot not found: ${snapshotId}`, 'SNAPSHOT_NOT_FOUND', {
      snapshotId,
    });
    this.name = 'SnapshotNotFoundError';
  }
}

export class AlgorithmNotFoundError extends WorkflowError {
  constructor(key: string, version: string) {
    super(`Algorithm definition not found: ${key}@${version}`, 'ALGORITHM_NOT_FOUND', { key, version });
    this.name = 'AlgorithmNotFoundError';
  }
}

export class UnsupportedAlgorithmError extends WorkflowError {
  constructor(algorithmKey: string) {
    super(`Unsupported algorithm: ${algorithmKey}`, 'UNSUPPORTED_ALGORITHM', { algorithmKey });
    this.name = 'UnsupportedAlgorithmError';
  }
}

export class MissingInputError extends WorkflowError {
  constructor(inputKey: string) {
    super(`Missing required input: ${inputKey}`, 'MISSING_INPUT', {
      inputKey,
    });
    this.name = 'MissingInputError';
  }
}
