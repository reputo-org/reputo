/**
 * @reputo/storage
 *
 * Framework-agnostic S3 storage layer for the Reputo ecosystem.
 * Provides a reusable abstraction over S3 with type-safe operations,
 * presigned URLs, and configurable constraints.
 */

export { createS3Client, type S3ClientConfig } from './s3-client.js';
export * from './shared/index.js';

export { Storage } from './storage.js';
