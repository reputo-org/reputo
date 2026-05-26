/**
 * Types of storage keys supported by the system.
 *
 * - 'upload': User-uploaded files (`uploads/{uuid}/{filename}.{ext}`)
 * - 'snapshot': Snapshot files (`snapshots/{snapshotId}/{filename}.{ext}`)
 */
export type StorageKeyType = 'upload' | 'snapshot';

export interface PresignPutOptions {
  bucket: string;
  filename: string;
  contentType: string;
  /** Time-to-live for the presigned URL in seconds. */
  ttl: number;
  maxSizeBytes: number;
  contentTypeAllowlist: string[];
}

export interface PresignGetOptions {
  bucket: string;
  key: string;
  /** Time-to-live for the presigned URL in seconds. */
  ttl: number;
}

export interface VerifyOptions {
  bucket: string;
  key: string;
  maxSizeBytes: number;
  /** Only validated for upload keys, not snapshot keys. */
  contentTypeAllowlist?: string[];
}

export interface GetObjectOptions {
  bucket: string;
  key: string;
}

export interface PutObjectOptions {
  bucket: string;
  key: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
  /** Only validated for upload keys, not snapshot keys. */
  contentTypeAllowlist?: string[];
}

interface ParsedStorageKeyBase {
  /**
   * Full filename including extension.
   *
   * @example 'data.csv'
   */
  filename: string;

  /**
   * File extension without the dot.
   *
   * @example 'csv'
   */
  ext: string;
}

/**
 * Parsed upload key components.
 * Pattern: `uploads/{uuid}/{filename}.{ext}`
 */
export interface ParsedUploadKey extends ParsedStorageKeyBase {
  type: 'upload';
  uuid: string;
}

/**
 * Parsed snapshot key components.
 * Pattern: `snapshots/{snapshotId}/{filename}.{ext}`
 */
export interface ParsedSnapshotKey extends ParsedStorageKeyBase {
  type: 'snapshot';
  snapshotId: string;
}

export type ParsedStorageKey = ParsedUploadKey | ParsedSnapshotKey;

export interface StorageMetadata {
  filename: string;
  ext: string;
  size: number;
  contentType: string;
  /**
   * Unix timestamp (seconds since epoch) when the metadata was retrieved.
   * For uploads, this is typically the current time. For snapshots, this is also the current time.
   */
  timestamp: number;
}

export interface PresignedUpload {
  key: string;
  url: string;
  /** Number of seconds until the URL expires. */
  expiresIn: number;
}

export interface PresignedDownload {
  url: string;
  /** Number of seconds until the URL expires. */
  expiresIn: number;
  metadata: StorageMetadata;
}

export interface DeleteObjectOptions {
  bucket: string;
  key: string;
}

export interface ListObjectsByPrefixOptions {
  bucket: string;
  prefix: string;
  /** Default is 1000 (S3 maximum). */
  maxKeys?: number;
}

export interface DeleteObjectsOptions {
  bucket: string;
  keys: string[];
}

export interface DeleteObjectsResult {
  deleted: string[];
  errors: Array<{
    key: string;
    message: string;
  }>;
}
