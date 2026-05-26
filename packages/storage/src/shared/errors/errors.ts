export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Error thrown when a file exceeds the maximum allowed size.
 *
 * Applications should catch this and return an appropriate HTTP 400 response
 * or handle it according to their error handling strategy.
 */
export class FileTooLargeError extends StorageError {
  readonly maxSizeBytes: number;

  constructor(maxSizeBytes: number) {
    super(`File too large. Maximum allowed size: ${maxSizeBytes} bytes`);
    this.name = 'FileTooLargeError';
    this.maxSizeBytes = maxSizeBytes;
  }
}

/**
 * Error thrown when a file's content type is not in the allowlist.
 *
 * Applications should catch this and return an appropriate HTTP 400 response
 * or handle it according to their error handling strategy.
 */
export class InvalidContentTypeError extends StorageError {
  readonly contentType: string;
  readonly allowedTypes: string[];

  constructor(contentType: string, allowedTypes: string[]) {
    super(`Content type not allowed. Allowed: ${allowedTypes.join(', ')}. Got: ${contentType}`);
    this.name = 'InvalidContentTypeError';
    this.contentType = contentType;
    this.allowedTypes = allowedTypes;
  }
}

/**
 * Error thrown when an object is not found in S3.
 *
 * This typically indicates a 404 response from S3.
 * Applications should catch this and return an appropriate HTTP 404 response
 * or handle it according to their error handling strategy.
 */
export class ObjectNotFoundError extends StorageError {
  constructor(key?: string) {
    const message = key ? `Object not found: ${key}` : 'Object not found';
    super(message);
    this.name = 'ObjectNotFoundError';
  }
}

/**
 * Error thrown when a HEAD request to S3 fails for reasons other than 404.
 *
 * This typically indicates a transient S3 error or permission issue.
 * Applications should catch this and return an appropriate HTTP 500 response
 * or handle it according to their error handling strategy.
 */
export class HeadObjectFailedError extends StorageError {
  constructor(key?: string) {
    const message = key ? `Failed to retrieve object metadata: ${key}` : 'Failed to retrieve object metadata';
    super(message);
    this.name = 'HeadObjectFailedError';
  }
}

/**
 * Error thrown when a storage key has an invalid format.
 *
 * This indicates the key doesn't match the expected structure
 * (e.g., 'uploads/{timestamp}/{filename}.{ext}').
 */
export class InvalidStorageKeyError extends StorageError {
  readonly key: string;

  constructor(key: string, reason?: string) {
    const message = reason ? `Invalid storage key format: ${key}. ${reason}` : `Invalid storage key format: ${key}`;
    super(message);
    this.name = 'InvalidStorageKeyError';
    this.key = key;
  }
}
