import { API_SNAPSHOT_ACTIVITIES_TASK_QUEUE, OAUTH_PROVIDERS, OAuthProviderDeepId } from '@reputo/contracts';
import { z } from 'zod';

import { AUTH_MODE_MOCK, AUTH_MODE_OAUTH } from '../shared/constants';

export const NODE_ENVS = ['production', 'development', 'test'] as const;
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export const AUTH_MODES = [AUTH_MODE_OAUTH, AUTH_MODE_MOCK] as const;
export const COOKIE_SAME_SITE = ['lax', 'strict', 'none'] as const;

const truthyStringBoolean = z
  .union([z.boolean(), z.enum(['true', '1', 'false', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).describe('Node runtime environment'),
    PORT: z.coerce.number().int().positive().default(3000).describe('HTTP port the Nest application listens on'),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info').describe('Pino log level'),

    AUTH_MODE: z
      .enum(AUTH_MODES)
      .default(AUTH_MODE_OAUTH)
      .describe('Authentication mode (oauth | mock); mock is rejected when NODE_ENV=production'),
    OWNER_EMAIL: z
      .string()
      .trim()
      .toLowerCase()
      .email()
      .optional()
      .describe('Email seeded as the single owner allowlist entry on bootstrap (required when AUTH_MODE=oauth)'),
    OWNER_PROVIDER: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(OAUTH_PROVIDERS as readonly [string, ...string[]]))
      .default(OAuthProviderDeepId)
      .describe('OAuth provider against which OWNER_EMAIL is seeded'),

    DEEP_ID_ISSUER_URL: z.string().url().describe('Deep ID issuer base URL'),
    DEEP_ID_CLIENT_ID: z.string().trim().min(1).describe('Deep ID OAuth client identifier'),
    DEEP_ID_CLIENT_SECRET: z.string().trim().min(1).describe('Deep ID OAuth client secret'),
    DEEP_ID_AUTH_REDIRECT_URI: z.string().url().describe('Deep ID OAuth auth callback URL'),
    DEEP_ID_AUTH_SCOPES: z.string().trim().min(1).describe('Space or comma separated Deep ID auth scopes'),

    AUTH_COOKIE_NAME: z
      .string()
      .trim()
      .min(1)
      .default('reputo_auth_session')
      .describe('Opaque auth session cookie name; must match the UI value'),
    AUTH_COOKIE_DOMAIN: z
      .string()
      .optional()
      .describe('Optional cookie domain override (empty string treated as unset)'),
    AUTH_COOKIE_SECURE: truthyStringBoolean.default(false).describe('Whether auth cookies require HTTPS'),
    AUTH_COOKIE_SAME_SITE: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(COOKIE_SAME_SITE))
      .default('lax')
      .describe('Auth cookie SameSite policy'),
    AUTH_SESSION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60 * 24 * 30)
      .describe('Maximum opaque session lifetime in seconds'),
    AUTH_REFRESH_LEEWAY_SECONDS: z.coerce
      .number()
      .int()
      .min(0)
      .default(60)
      .describe('Seconds before access token expiry when refresh should happen'),
    AUTH_SESSION_CLEANUP_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(0)
      .default(60 * 60 * 1000)
      .describe('Interval (ms) for the auth-session expiry cleanup job; 0 disables the cron'),
    AUTH_TOKEN_ENCRYPTION_KEY: z
      .string()
      .trim()
      .min(32)
      .describe('Secret used to encrypt provider tokens and transient auth flow cookies'),
    APP_PUBLIC_URL: z.string().url().describe('Public application URL used after login'),

    DEEP_ID_CONSENT_REDIRECT_URI: z.string().url().describe('Deep ID OAuth callback URL for consent flows'),
    DEEP_ID_CONSENT_GRANT_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .describe('Transient Deep ID consent grant lifetime in seconds'),
    DEEP_ID_CONSENT_CLEANUP_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(0)
      .default(5 * 60 * 1000)
      .describe('Interval (ms) for the consent-grant expiry cleanup job; 0 disables the cron'),
    VOTING_PORTAL_RETURN_URL: z.string().url().describe('Voting Portal return URL after consent'),
    DEEP_ID_VOTING_PORTAL_SCOPES: z.string().min(1).describe('Deep ID scopes requested for Voting Portal consent'),

    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
        error: 'DATABASE_URL must use the postgresql:// or postgres:// scheme',
      })
      .describe('PostgreSQL connection URL for the API application database (consumed by TypeORM)'),

    AWS_REGION: z.string().min(1).describe('AWS region for S3 and other AWS clients'),
    // AWS credentials are NOT validated here. The AWS SDK reads
    // AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY from the container env via its
    // default credential provider chain (or falls through to IAM in prod).
    // Compose files inject MinIO creds for dev/preview.

    STORAGE_BUCKET: z.string().min(1).describe('S3 bucket name for algorithm inputs and outputs'),
    STORAGE_ENDPOINT: z
      .string()
      .url()
      .optional()
      .describe('Custom S3 endpoint URL (e.g. http://minio:9000 for dev/preview MinIO). Omit to use AWS S3.'),
    STORAGE_FORCE_PATH_STYLE: z
      .stringbool()
      .optional()
      .describe('Use path-style S3 URLs (required by MinIO/LocalStack). Set together with STORAGE_ENDPOINT.'),
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
    STORAGE_CONTENT_TYPE_ALLOWLIST: z
      .string()
      .min(1)
      .default('text/csv,text/plain,application/json')
      .describe('Comma-separated MIME allowlist; consumers split this themselves'),

    TEMPORAL_ADDRESS: z
      .string()
      .regex(/^[^:\s]+:\d+$/, 'TEMPORAL_ADDRESS must be host:port (e.g. temporal:7233)')
      .describe('Temporal server address (host:port)'),
    TEMPORAL_NAMESPACE: z.string().min(1).default('default').describe('Temporal namespace'),
    TEMPORAL_ORCHESTRATOR_TASK_QUEUE: z
      .string()
      .min(1)
      .default('orchestrator-worker')
      .describe('Temporal task queue for orchestrator workflows'),
    TEMPORAL_API_SNAPSHOT_ACTIVITIES_TASK_QUEUE: z
      .string()
      .min(1)
      .default(API_SNAPSHOT_ACTIVITIES_TASK_QUEUE)
      .describe('Temporal task queue the API worker hosts snapshot activities on'),
  })
  .refine((e) => e.NODE_ENV !== 'production' || e.AUTH_MODE !== AUTH_MODE_MOCK, {
    error: 'AUTH_MODE=mock is not permitted when NODE_ENV=production.',
    path: ['AUTH_MODE'],
  })
  .refine((e) => e.AUTH_MODE !== AUTH_MODE_OAUTH || (e.OWNER_EMAIL !== undefined && e.OWNER_EMAIL.length > 0), {
    error: 'OWNER_EMAIL is required when AUTH_MODE=oauth.',
    path: ['OWNER_EMAIL'],
  });

export type Env = z.infer<typeof envSchema>;

const rawEnv = { ...process.env };
if (rawEnv.AUTH_COOKIE_DOMAIN === '') {
  delete rawEnv.AUTH_COOKIE_DOMAIN;
}

const parsed = envSchema.safeParse(rawEnv);
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
