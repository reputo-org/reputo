import { randomUUID } from 'node:crypto';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  FileTooLargeError,
  HeadObjectFailedError,
  InvalidContentTypeError,
  ObjectNotFoundError,
} from './shared/errors/index.js';
import type {
  DeleteObjectOptions,
  DeleteObjectsOptions,
  DeleteObjectsResult,
  GetObjectOptions,
  ListObjectsByPrefixOptions,
  ParsedStorageKey,
  PresignedDownload,
  PresignedUpload,
  PresignGetOptions,
  PresignPutOptions,
  PutObjectOptions,
  StorageMetadata,
  VerifyOptions,
} from './shared/types/index.js';
import { detectKeyType, generateKey, parseStorageKey } from './shared/utils/keys.js';

/**
 * Main storage class that wraps an S3Client instance.
 *
 * Provides a high-level API for:
 * - Generating presigned URLs for uploads and downloads
 * - Verifying uploaded files against size and content-type policies
 * - Reading and writing objects directly
 *
 * Each method accepts operation-specific options, allowing callers to
 * specify bucket, TTLs, size limits, and content type constraints per call.
 *
 * The Storage instance does NOT create its own S3Client.
 * Applications must inject a configured S3Client instance.
 *
 * @example
 * ```typescript
 * import { S3Client } from '@aws-sdk/client-s3';
 * import { Storage } from '@reputo/storage';
 *
 * const s3Client = new S3Client({ region: 'us-east-1' });
 * const storage = new Storage(s3Client);
 *
 * // Generate upload URL with per-call options
 * const upload = await storage.presignPut({
 *   bucket: 'my-bucket',
 *   filename: 'data.csv',
 *   contentType: 'text/csv',
 *   ttl: 3600,
 *   maxSizeBytes: 104857600,
 *   contentTypeAllowlist: ['text/csv', 'application/json'],
 * });
 * console.log(upload.key, upload.url);
 *
 * // Verify upload with per-call options
 * const result = await storage.verify({
 *   bucket: 'my-bucket',
 *   key: upload.key,
 *   maxSizeBytes: 104857600,
 *   contentTypeAllowlist: ['text/csv', 'application/json'],
 * });
 * console.log(result.metadata);
 *
 * // Generate download URL with per-call options
 * const download = await storage.presignGet({
 *   bucket: 'my-bucket',
 *   key: upload.key,
 *   ttl: 900,
 * });
 * console.log(download.url);
 * ```
 */
export class Storage {
  constructor(private readonly s3Client: S3Client) {}

  /**
   * Generates a presigned URL for uploading a file.
   *
   * The client can use this URL to upload the file directly to S3
   * without going through your application server.
   *
   * @param options - Upload operation options
   * @returns Upload information including the key and presigned URL
   * @throws {InvalidContentTypeError} If content type is not in allowlist
   *
   * @example
   * ```typescript
   * const result = await storage.presignPut({
   *   bucket: 'my-bucket',
   *   filename: 'votes.csv',
   *   contentType: 'text/csv',
   *   ttl: 3600,
   *   maxSizeBytes: 104857600,
   *   contentTypeAllowlist: ['text/csv'],
   * });
   * // result.key: 'uploads/{uuid}/votes.csv'
   * // result.url: 'https://bucket.s3.amazonaws.com/...'
   * // result.expiresIn: 3600
   * ```
   */
  async presignPut(options: PresignPutOptions): Promise<PresignedUpload> {
    const { bucket, filename, contentType, ttl, contentTypeAllowlist } = options;

    this.validateContentType(contentType, contentTypeAllowlist);

    const uuid = randomUUID();
    const key = generateKey('upload', uuid, filename);

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    });

    const url = await getSignedUrl(this.s3Client, command, {
      expiresIn: ttl,
    });

    return {
      key,
      url,
      expiresIn: ttl,
    };
  }

  /**
   * Verifies that a file meets size requirements and optionally content-type policies.
   *
   * Supports all key patterns:
   * - Upload keys (`uploads/...`): validates size AND content type against allowlist
   * - Snapshot keys (`snapshots/...`): validates size only (internal use)
   *
   * @param options - Verify operation options
   * @returns Verification result with metadata
   * @throws {ObjectNotFoundError} If the object doesn't exist
   * @throws {HeadObjectFailedError} If metadata retrieval fails
   * @throws {FileTooLargeError} If file exceeds max size
   * @throws {InvalidContentTypeError} If content type is not allowed (upload keys only)
   *
   * @example
   * ```typescript
   * // Verify an upload (validates content type)
   * const result = await storage.verify({
   *   bucket: 'my-bucket',
   *   key: 'uploads/{uuid}/votes.csv',
   *   maxSizeBytes: 104857600,
   *   contentTypeAllowlist: ['text/csv'],
   * });
   *
   * // Verify a snapshot (skips content type validation)
   * const result = await storage.verify({
   *   bucket: 'my-bucket',
   *   key: 'snapshots/abc123/voting_engagement.csv',
   *   maxSizeBytes: 104857600,
   * });
   * ```
   */
  async verify(options: VerifyOptions): Promise<{ key: string; metadata: StorageMetadata }> {
    const { bucket, key, maxSizeBytes, contentTypeAllowlist } = options;

    const head = await this.getObjectMetadata(bucket, key);

    const size = head.ContentLength ?? 0;
    const contentType = head.ContentType ?? 'application/octet-stream';

    // Always validate file size
    this.validateFileSize(size, maxSizeBytes);

    // Only validate content type for user uploads (not internal snapshot files)
    const keyType = detectKeyType(key);
    if (keyType === 'upload' && contentTypeAllowlist) {
      this.validateContentType(contentType, contentTypeAllowlist);
    }

    const parsed = parseStorageKey(key);
    const timestamp = this.getTimestampFromParsedKey(parsed);

    return {
      key,
      metadata: {
        filename: parsed.filename,
        ext: parsed.ext,
        size,
        contentType,
        timestamp,
      },
    };
  }

  /**
   * Generates a presigned URL for downloading a file.
   *
   * Supports all key patterns:
   * - Upload keys: `uploads/{uuid}/{filename}.{ext}`
   * - Snapshot keys: `snapshots/{snapshotId}/{filename}.{ext}`
   *
   * The timestamp in metadata is set to the current Unix timestamp for all key types.
   *
   * @param options - Download operation options
   * @returns Download information including presigned URL and metadata
   * @throws {ObjectNotFoundError} If the object doesn't exist
   * @throws {HeadObjectFailedError} If metadata retrieval fails
   *
   * @example
   * ```typescript
   * // Download an upload
   * const result = await storage.presignGet({
   *   bucket: 'my-bucket',
   *   key: 'uploads/{uuid}/votes.csv',
   *   ttl: 900,
   * });
   *
   * // Download a snapshot
   * const result = await storage.presignGet({
   *   bucket: 'my-bucket',
   *   key: 'snapshots/abc123/voting_engagement.csv',
   *   ttl: 900,
   * });
   * ```
   */
  async presignGet(options: PresignGetOptions): Promise<PresignedDownload> {
    const { bucket, key, ttl } = options;

    const head = await this.getObjectMetadata(bucket, key);

    const size = head.ContentLength ?? 0;
    const contentType = head.ContentType ?? 'application/octet-stream';

    const parsed = parseStorageKey(key);
    const timestamp = this.getTimestampFromParsedKey(parsed);

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    const url = await getSignedUrl(this.s3Client, command, {
      expiresIn: ttl,
    });

    return {
      url,
      expiresIn: ttl,
      metadata: {
        filename: parsed.filename,
        ext: parsed.ext,
        size,
        contentType,
        timestamp,
      },
    };
  }

  /**
   * Reads an object from S3 and returns its contents as a Buffer.
   *
   * Use this for server-side object reads. For client downloads,
   * use presignGet() to generate a download URL instead.
   *
   * @param options - Read operation options
   * @returns Object contents as a Buffer
   * @throws {ObjectNotFoundError} If the object doesn't exist
   *
   * @example
   * ```typescript
   * const buffer = await storage.getObject({
   *   bucket: 'my-bucket',
   *   key: 'uploads/{uuid}/votes.csv',
   * });
   * const text = buffer.toString('utf-8');
   * console.log(text);
   * ```
   */
  async getObject(options: GetObjectOptions): Promise<Buffer> {
    const { bucket, key } = options;

    try {
      const result = await this.s3Client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );

      const chunks: Buffer[] = [];
      // @ts-expect-error - Body type varies by runtime (Node.js vs browser)
      for await (const chunk of result.Body) {
        chunks.push(Buffer.from(chunk as Buffer));
      }

      return Buffer.concat(chunks);
    } catch (error: unknown) {
      const err = error as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };

      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        throw new ObjectNotFoundError(key);
      }

      throw error;
    }
  }

  /**
   * Writes an object to S3.
   *
   * Use this for server-side uploads. For client uploads,
   * use presignPut() to generate an upload URL instead.
   *
   * Content type validation is only applied for upload keys (`uploads/...`).
   * Snapshot keys (`snapshots/...`) bypass content type validation for internal use.
   *
   * @param options - Write operation options
   * @returns The key of the stored object
   * @throws {InvalidContentTypeError} If content type is not allowed (upload keys only)
   *
   * @example
   * ```typescript
   * // Upload with content type validation
   * const csvData = 'name,score\nAlice,100\nBob,95';
   * await storage.putObject({
   *   bucket: 'my-bucket',
   *   key: 'uploads/{uuid}/results.csv',
   *   body: csvData,
   *   contentType: 'text/csv',
   *   contentTypeAllowlist: ['text/csv'],
   * });
   *
   * // Snapshot (skips content type validation)
   * await storage.putObject({
   *   bucket: 'my-bucket',
   *   key: 'snapshots/abc123/voting_engagement.csv',
   *   body: csvData,
   *   contentType: 'text/csv',
   * });
   * ```
   */
  async putObject(options: PutObjectOptions): Promise<string> {
    const { bucket, key, body, contentType, contentTypeAllowlist } = options;

    // Only validate content type for user uploads (not internal snapshot files)
    const keyType = detectKeyType(key);
    if (contentType && keyType === 'upload' && contentTypeAllowlist) {
      this.validateContentType(contentType, contentTypeAllowlist);
    }

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );

    return key;
  }

  /**
   * Deletes a single object from S3.
   *
   * This operation is idempotent - if the object doesn't exist, no error is thrown.
   *
   * @param options - Delete operation options
   * @returns Promise that resolves when the object is deleted
   *
   * @example
   * ```typescript
   * await storage.deleteObject({
   *   bucket: 'my-bucket',
   *   key: 'uploads/{uuid}/votes.csv',
   * });
   * ```
   */
  async deleteObject(options: DeleteObjectOptions): Promise<void> {
    const { bucket, key } = options;

    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
  }

  /**
   * Lists all objects under a given prefix.
   *
   * Handles pagination automatically and returns all matching keys.
   *
   * @param options - List operation options
   * @returns Array of object keys matching the prefix
   *
   * @example
   * ```typescript
   * const keys = await storage.listObjectsByPrefix({
   *   bucket: 'my-bucket',
   *   prefix: 'snapshots/abc123/',
   * });
   * // Returns: ['snapshots/abc123/file1.csv', 'snapshots/abc123/file2.json', ...]
   * ```
   */
  async listObjectsByPrefix(options: ListObjectsByPrefixOptions): Promise<string[]> {
    const { bucket, prefix, maxKeys } = options;
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          MaxKeys: maxKeys,
          ContinuationToken: continuationToken,
        }),
      );

      if (response.Contents) {
        for (const obj of response.Contents) {
          if (obj.Key) {
            keys.push(obj.Key);
          }
        }
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return keys;
  }

  /**
   * Deletes multiple objects from S3 in a single batch request.
   *
   * S3 allows up to 1000 objects per DeleteObjects request.
   * If more than 1000 keys are provided, they are automatically batched.
   *
   * This operation is idempotent - if any object doesn't exist, no error is thrown for that object.
   *
   * @param options - Batch delete operation options
   * @returns Result with deleted keys and any errors
   *
   * @example
   * ```typescript
   * const result = await storage.deleteObjects({
   *   bucket: 'my-bucket',
   *   keys: ['uploads/a/file1.csv', 'uploads/b/file2.csv'],
   * });
   * console.log(`Deleted ${result.deleted.length} objects`);
   * ```
   */
  async deleteObjects(options: DeleteObjectsOptions): Promise<DeleteObjectsResult> {
    const { bucket, keys } = options;

    if (keys.length === 0) {
      return { deleted: [], errors: [] };
    }

    const deleted: string[] = [];
    const errors: Array<{ key: string; message: string }> = [];

    // S3 allows max 1000 objects per DeleteObjects request
    const BATCH_SIZE = 1000;

    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const batch = keys.slice(i, i + BATCH_SIZE);

      try {
        const response = await this.s3Client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: batch.map((key) => ({ Key: key })),
              Quiet: false,
            },
          }),
        );

        if (response.Deleted) {
          for (const obj of response.Deleted) {
            if (obj.Key) {
              deleted.push(obj.Key);
            }
          }
        }

        if (response.Errors) {
          for (const error of response.Errors) {
            if (error.Key) {
              errors.push({
                key: error.Key,
                message: error.Message || 'Unknown error',
              });
            }
          }
        }
      } catch (error) {
        // If entire batch fails, mark all keys as errors
        const err = error as Error;
        for (const key of batch) {
          errors.push({
            key,
            message: err.message || 'Batch delete failed',
          });
        }
      }
    }

    return { deleted, errors };
  }

  /**
   * Validates that a file size is within the allowed maximum.
   *
   * @param size - File size in bytes
   * @param maxSizeBytes - Maximum allowed size in bytes
   * @throws {FileTooLargeError} If size exceeds maxSizeBytes
   *
   * @private
   */
  private validateFileSize(size: number, maxSizeBytes: number): void {
    if (size > maxSizeBytes) {
      throw new FileTooLargeError(maxSizeBytes);
    }
  }

  /**
   * Validates that a content type is in the allowlist.
   *
   * @param contentType - MIME type to validate
   * @param allowlist - List of allowed content types
   * @throws {InvalidContentTypeError} If content type is not allowed
   *
   * @private
   */
  private validateContentType(contentType: string, allowlist: string[]): void {
    const allowedSet = new Set(allowlist);
    if (!allowedSet.has(contentType)) {
      throw new InvalidContentTypeError(contentType, allowlist);
    }
  }

  private getTimestampFromParsedKey(_parsed: ParsedStorageKey): number {
    return Math.floor(Date.now() / 1000);
  }

  /**
   * Retrieves object metadata using a HEAD request.
   *
   * @param bucket - S3 bucket name
   * @param key - S3 key of the object
   * @returns S3 HeadObject response
   * @throws {ObjectNotFoundError} If object doesn't exist
   * @throws {HeadObjectFailedError} If metadata retrieval fails
   *
   * @private
   */
  private async getObjectMetadata(bucket: string, key: string) {
    try {
      return await this.s3Client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );
    } catch (error: unknown) {
      const err = error as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };

      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        throw new ObjectNotFoundError(key);
      }

      throw new HeadObjectFailedError(key);
    }
  }
}
