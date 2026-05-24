import { S3Client } from '@aws-sdk/client-s3';

export interface S3ClientConfig {
  /**
   * AWS region for S3 operations.
   *
   * @example 'us-east-1'
   */
  region: string;

  /**
   * AWS access key ID.
   * Only used in non-production environments when explicitly provided.
   */
  accessKeyId?: string;

  /**
   * AWS secret access key.
   * Only used in non-production environments when explicitly provided.
   */
  secretAccessKey?: string;
}

/**
 * Creates a configured S3 client instance.
 *
 * In production environments, credentials are obtained from the environment
 * (IAM roles, environment variables, etc.) and explicit credentials are ignored.
 *
 * In non-production environments, explicit credentials can be provided for
 * local development with services like LocalStack or MinIO.
 *
 * @param config - S3 client configuration options
 * @param nodeEnv - Current Node.js environment (e.g., 'production', 'development', 'test')
 * @returns Configured S3Client instance
 *
 * @example
 * ```typescript
 * // Production - uses IAM role or environment credentials
 * const client = createS3Client({ region: 'us-east-1' }, 'production');
 *
 * // Development with explicit credentials
 * const client = createS3Client({
 *   region: 'us-east-1',
 *   accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
 *   secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
 * }, 'development');
 *
 * // LocalStack or MinIO
 * const client = createS3Client({
 *   region: 'us-east-1',
 *   endpoint: 'http://localhost:4566',
 *   forcePathStyle: true,
 *   accessKeyId: 'test',
 *   secretAccessKey: 'test',
 * }, 'development');
 * ```
 */
export function createS3Client(config: S3ClientConfig, nodeEnv: string): S3Client {
  const s3ClientConfig: ConstructorParameters<typeof S3Client>[0] = {
    region: config.region,
  };

  if (nodeEnv !== 'production') {
    s3ClientConfig.credentials = {
      accessKeyId: config.accessKeyId as string,
      secretAccessKey: config.secretAccessKey as string,
    };
  }

  return new S3Client(s3ClientConfig);
}
