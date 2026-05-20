import { registerAs } from '@nestjs/config';
import * as Joi from 'joi';

export default registerAs('aws', () => ({
  region: process.env.AWS_REGION,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
}));

export const awsConfigSchema = {
  AWS_REGION: Joi.string().required().description('AWS region for S3 bucket'),
  S3_ENDPOINT: Joi.string()
    .uri()
    .optional()
    .allow('')
    .description('Custom S3 endpoint, e.g. http://minio:9000. Leave empty for real AWS S3.'),
  S3_FORCE_PATH_STYLE: Joi.boolean()
    .optional()
    .default(false)
    .description('Force path-style addressing. Required for MinIO; auto-defaults to true when S3_ENDPOINT is set.'),
};
