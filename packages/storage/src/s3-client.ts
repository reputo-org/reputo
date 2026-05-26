import { S3Client } from '@aws-sdk/client-s3';

export interface S3ClientConfig {
  /**
   * AWS region for S3 operations.
   *
   * @example 'us-east-1'
   */
  region: string;

  /**
   * Custom S3 endpoint URL. Used to point at an S3-compatible service
   * (MinIO, LocalStack, etc.) instead of AWS. Omit for AWS S3.
   *
   * @example 'http://minio:9000'
   */
  endpoint?: string;

  /**
   * Use path-style URLs (`https://endpoint/bucket/key`) instead of
   * virtual-hosted-style (`https://bucket.endpoint/key`). Required by most
   * S3-compatible services such as MinIO.
   *
   * @default false
   */
  forcePathStyle?: boolean;
}

/**
 * Creates a configured S3 client instance.
 *
 * Credentials are always sourced from the AWS SDK's default credential
 * provider chain (env vars `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`,
 * shared credentials file, IAM role, container/EC2 metadata, etc.). Callers
 * never pass credentials directly — set the env vars in the container instead
 * (compose files do this for dev/preview MinIO; prod relies on the IAM role).
 *
 * @param config - S3 client configuration options
 * @returns Configured S3Client instance
 *
 * @example
 * ```typescript
 * // Production - SDK uses IAM role / instance profile / env creds.
 * const client = createS3Client({ region: 'us-east-1' });
 *
 * // MinIO or LocalStack — set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in
 * // the container env; the SDK picks them up automatically.
 * const client = createS3Client({
 *   region: 'us-east-1',
 *   endpoint: 'http://minio:9000',
 *   forcePathStyle: true,
 * });
 * ```
 */
export function createS3Client(config: S3ClientConfig): S3Client {
  const s3ClientConfig: ConstructorParameters<typeof S3Client>[0] = {
    region: config.region,
  };

  if (config.endpoint) {
    s3ClientConfig.endpoint = config.endpoint;
  }

  if (config.forcePathStyle) {
    s3ClientConfig.forcePathStyle = true;
  }

  return new S3Client(s3ClientConfig);
}
