import { S3Client } from '@aws-sdk/client-s3';

/**
 * Configuration options for creating an S3 client.
 *
 * Credentials are intentionally not part of this surface — the AWS SDK
 * resolves them from its default credential chain (env, container creds,
 * IAM role, or `~/.aws/credentials`).
 */
export interface S3ClientConfig {
  /** AWS region. */
  region: string;

  /** Custom endpoint for MinIO / LocalStack. Leave undefined for real AWS S3. */
  endpoint?: string;

  /**
   * Force path-style addressing. Required for MinIO; defaults to `true` when
   * `endpoint` is set, otherwise `false`.
   */
  forcePathStyle?: boolean;
}

export function createS3Client(config: S3ClientConfig): S3Client {
  const endpoint = config.endpoint && config.endpoint.length > 0 ? config.endpoint : undefined;
  const forcePathStyle = endpoint ? (config.forcePathStyle ?? true) : config.forcePathStyle;

  return new S3Client({
    region: config.region,
    ...(endpoint ? { endpoint } : {}),
    ...(typeof forcePathStyle === 'boolean' ? { forcePathStyle } : {}),
  });
}
