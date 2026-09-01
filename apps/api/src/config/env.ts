import { API_SNAPSHOT_ACTIVITIES_TASK_QUEUE, OAUTH_PROVIDERS, OAuthProviderDeepId } from '@reputo/contracts';
import { z } from 'zod';

import {
  AUTH_MODE_MOCK,
  AUTH_MODE_OAUTH,
  COMMUNITY_CONNECTIONS_ROUTE,
  GITHUB_CALLBACK_ROUTE,
} from '../shared/constants';

export const NODE_ENVS = ['production', 'development', 'test'] as const;
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export const AUTH_MODES = [AUTH_MODE_OAUTH, AUTH_MODE_MOCK] as const;
export const COOKIE_SAME_SITE = ['lax', 'strict', 'none'] as const;

/** The App's setup URL must land on this API's callback route, or a connect can never complete. */
const GITHUB_CALLBACK_PATH = `${COMMUNITY_CONNECTIONS_ROUTE}/${GITHUB_CALLBACK_ROUTE}`;

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
    DEEP_ID_ADMIN_CLIENT_ID: z.string().trim().min(1).describe('Deep ID admin OAuth client identifier'),
    DEEP_ID_ADMIN_CLIENT_SECRET: z.string().trim().min(1).describe('Deep ID admin OAuth client secret'),
    DEEP_ID_ADMIN_REDIRECT_URI: z.string().url().describe('Deep ID admin OAuth callback URL'),
    DEEP_ID_ADMIN_SCOPES: z.string().trim().min(1).describe('Space or comma separated Deep ID admin scopes'),
    DEEP_ID_CLIENT_ID: z.string().trim().min(1).describe('Deep ID OAuth client identifier (consent + score posting)'),
    DEEP_ID_CLIENT_SECRET: z.string().trim().min(1).describe('Deep ID OAuth client secret (consent + score posting)'),

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
    DEEP_ID_CONSENT_SCOPES: z
      .string()
      .trim()
      .min(1)
      .describe('Space separated Deep ID scopes requested during the interactive consent flow'),

    DISCORD_CLIENT_ID: z.string().trim().min(1).describe('Discord application (bot) client identifier'),
    DISCORD_CLIENT_SECRET: z.string().trim().min(1).describe('Discord application client secret'),
    DISCORD_BOT_TOKEN: z
      .string()
      .trim()
      .min(1)
      .describe('Discord bot token used for read-only guild calls; never persisted to the database'),
    DISCORD_BOT_CALLBACK_URL: z.string().url().describe('Discord bot install callback URL handled by this API'),

    GITHUB_APP_ID: z.string().trim().min(1).describe('GitHub App identifier'),
    GITHUB_APP_PRIVATE_KEY: z
      .string()
      .trim()
      .min(1)
      // Deployment variables are single-line, so a PEM arrives with escaped newlines.
      .transform((value) => value.replace(/\\n/g, '\n'))
      .describe('PEM-encoded GitHub App private key; signs the app JWT and is never persisted'),
    GITHUB_APP_SLUG: z.string().trim().min(1).describe('GitHub App URL slug used to build the install redirect'),
    GITHUB_APP_CALLBACK_URL: z
      .string()
      .url()
      .refine((value) => new URL(value).pathname.endsWith(GITHUB_CALLBACK_PATH), {
        error: `GITHUB_APP_CALLBACK_URL must end with "${GITHUB_CALLBACK_PATH}" — it is the App's setup URL and has to reach this API's callback route`,
      })
      .describe("GitHub App setup URL; must match the App configuration and this API's callback route"),

    COMMUNITY_CREDENTIALS_ENCRYPTION_KEY: z
      .string()
      .min(32)
      .describe('Secret that seals community platform tokens (Mattermost) at rest; 32+ chars'),
    COMMUNITY_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS: z
      .string()
      .optional()
      // Deployment variable shells arrive as empty strings; treat those as unset.
      .transform((value) => (value === '' ? undefined : value))
      .pipe(z.string().min(32).optional())
      .describe('Previous sealing secret, kept during rotation so existing envelopes still open'),
    COMMUNITY_MATTERMOST_ALLOWED_HOSTS: z
      .string()
      .default('')
      .transform((value) =>
        value
          .split(',')
          .map((host) => host.trim().toLowerCase())
          .filter((host) => host.length > 0),
      )
      .describe(
        'Comma-separated hostnames exempt from the outbound HTTPS and public-address rules (e.g. the dev Mattermost container). Deployment configuration, never user input.',
      ),
    COMMUNITY_MATTERMOST_MAX_RESPONSE_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(5_242_880)
      .describe('Cap on a single Mattermost response body in bytes'),
    COMMUNITY_INSTALL_STATE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(600)
      .describe('Lifetime of a signed community install-state value in seconds'),
    COMMUNITY_API_REQUEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15_000)
      .describe('Per-request timeout for community platform calls'),
    COMMUNITY_API_RETRY_MAX_ATTEMPTS: z.coerce
      .number()
      .int()
      .positive()
      .default(4)
      .describe('Maximum attempts per community platform call, including the first'),
    COMMUNITY_API_RETRY_BASE_DELAY_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(500)
      .describe('Base delay for community platform retry backoff'),
    COMMUNITY_API_RETRY_MAX_DELAY_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(10_000)
      .describe('Maximum delay for community platform retry backoff'),

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
    TEMPORAL_HEALTH_CHECK_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(0)
      .default(30_000)
      .describe('Interval (ms) for the Temporal reachability probe reported by /health; 0 disables the probe'),

    SNAPSHOT_RECONCILE_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(0)
      .default(60_000)
      .describe('Interval (ms) between snapshot lifecycle reconciliation passes; 0 disables the reconciler'),
    SNAPSHOT_RECONCILE_GRACE_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(120_000)
      .describe('Minimum age (ms) since the last update before a queued/running snapshot is reconciled'),
    SNAPSHOT_START_FAILED_AFTER_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(600_000)
      .describe('Age (ms) after which a queued snapshot whose workflow cannot be started is marked failed'),
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
