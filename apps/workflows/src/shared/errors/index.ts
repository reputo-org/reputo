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
