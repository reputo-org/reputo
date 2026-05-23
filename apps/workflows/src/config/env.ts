import { z } from 'zod';

export const NODE_ENVS = ['production', 'development', 'test'] as const;
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;

export const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).describe('Node runtime environment'),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info').describe('Pino log level'),

    TEMPORAL_ADDRESS: z.string().min(1).describe('Temporal server address (host:port)'),
    TEMPORAL_NAMESPACE: z.string().min(1).default('default').describe('Temporal namespace'),
    TEMPORAL_ORCHESTRATOR_TASK_QUEUE: z.string().min(1).describe('Temporal task queue for orchestrator workflows'),
    TEMPORAL_ALGORITHM_TYPESCRIPT_TASK_QUEUE: z
      .string()
      .min(1)
      .describe('Temporal task queue for TypeScript algorithm workers'),
    TEMPORAL_ALGORITHM_PYTHON_TASK_QUEUE: z
      .string()
      .min(1)
      .describe('Temporal task queue for Python algorithm workers'),
    TEMPORAL_ONCHAIN_DATA_TASK_QUEUE: z
      .string()
      .min(1)
      .describe('Temporal task queue for onchain-data dependency resolution'),

    AWS_REGION: z.string().min(1).describe('AWS region for S3 and other AWS clients'),
    AWS_ACCESS_KEY_ID: z.string().min(1).optional().describe('AWS access key ID (omit to use IAM role credentials)'),
    AWS_SECRET_ACCESS_KEY: z
      .string()
      .min(1)
      .optional()
      .describe('AWS secret access key (omit to use IAM role credentials)'),

    STORAGE_BUCKET: z.string().min(1).describe('S3 bucket name for algorithm inputs and outputs'),
    STORAGE_PRESIGN_PUT_TTL: z.coerce
      .number()
      .int()
      .positive()
      .default(120)
      .describe('Presigned PUT URL TTL in seconds'),
    STORAGE_PRESIGN_GET_TTL: z.coerce
      .number()
      .int()
      .positive()
      .default(300)
      .describe('Presigned GET URL TTL in seconds'),
    STORAGE_MAX_SIZE_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(52_428_800)
      .describe('Maximum object size in bytes'),

    DEEPFUNDING_API_BASE_URL: z.string().min(1).describe('DeepFunding API base URL'),
    DEEPFUNDING_API_KEY: z.string().min(1).describe('DeepFunding API key (required for the orchestrator worker)'),
    DEEPFUNDING_API_REQUEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .default(45_000)
      .describe('DeepFunding API request timeout in milliseconds'),
    DEEPFUNDING_API_CONCURRENCY: z.coerce
      .number()
      .int()
      .min(1)
      .max(50)
      .default(4)
      .describe('DeepFunding API concurrency limit'),
    DEEPFUNDING_API_DEFAULT_PAGE_LIMIT: z.coerce
      .number()
      .int()
      .min(1)
      .default(500)
      .describe('DeepFunding API default page limit'),
    DEEPFUNDING_API_RETRY_MAX_ATTEMPTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(7)
      .describe('DeepFunding API max retry attempts'),
    DEEPFUNDING_API_RETRY_BASE_DELAY_MS: z.coerce
      .number()
      .int()
      .min(0)
      .default(500)
      .describe('DeepFunding API retry base delay in milliseconds'),
    DEEPFUNDING_API_RETRY_MAX_DELAY_MS: z.coerce
      .number()
      .int()
      .min(0)
      .default(20_000)
      .describe('DeepFunding API retry max delay in milliseconds'),

    ONCHAIN_DATABASE_URL: z
      .string()
      .url()
      .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
        error: 'ONCHAIN_DATABASE_URL must use the postgresql:// or postgres:// scheme',
      })
      .describe('PostgreSQL connection URL for the onchain-data database'),

    ALCHEMY_API_KEY: z.string().min(1).describe('Alchemy API key (required for the onchain-data worker)'),
    BLOCKFROST_API_KEY: z
      .string()
      .min(1)
      .describe('Blockfrost API key for Cardano (required for the onchain-data worker)'),
  })
  .refine(
    (e) =>
      (e.AWS_ACCESS_KEY_ID === undefined && e.AWS_SECRET_ACCESS_KEY === undefined) ||
      (e.AWS_ACCESS_KEY_ID !== undefined && e.AWS_SECRET_ACCESS_KEY !== undefined),
    {
      error: 'AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set together or both omitted',
      path: ['AWS_ACCESS_KEY_ID'],
    },
  );

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const lines = parsed.error.issues.map((issue) => {
    const key = issue.path.length > 0 ? issue.path.join('.') : '<root>';
    return `  - ${key}: ${issue.message}`;
  });
  const message = `Invalid environment variables:\n${lines.join('\n')}`;
  process.stderr.write(`${message}\n`);
  throw new Error(message);
}

export const env: Env = parsed.data;
