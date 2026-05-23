import { z } from 'zod';
import { secretString } from './secret.js';

/**
 * Shared AWS env shape.
 *
 * `AWS_REGION` is always required. The access key / secret pair is optional
 * (containers in EKS/ECS use IAM roles) but both-or-neither — supplying only
 * one is a misconfiguration that would silently fall back to the role.
 */
export const awsEnvSchema = z
  .object({
    AWS_REGION: z.string().min(1).describe('AWS region for S3 and other AWS clients'),
    AWS_ACCESS_KEY_ID: secretString('AWS access key ID (omit to use IAM role credentials)').optional(),
    AWS_SECRET_ACCESS_KEY: secretString('AWS secret access key (omit to use IAM role credentials)').optional(),
  })
  .refine(
    (env) =>
      (env.AWS_ACCESS_KEY_ID === undefined && env.AWS_SECRET_ACCESS_KEY === undefined) ||
      (env.AWS_ACCESS_KEY_ID !== undefined && env.AWS_SECRET_ACCESS_KEY !== undefined),
    {
      error: 'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set together or both omitted',
      path: ['AWS_ACCESS_KEY_ID'],
    },
  );

export type AwsEnv = z.infer<typeof awsEnvSchema>;
