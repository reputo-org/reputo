export type RetryConfig = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export type DeepIdApiConfig = {
  /** OAuth 2.0 / OIDC host that issues the client-credentials token, e.g. `https://identity.staging.deep-id.ai`. */
  identityBaseUrl: string;
  /** Application API host that serves `/v1/...`, e.g. `https://app.staging.deep-id.ai`. */
  appBaseUrl: string;
  clientId: string;
  clientSecret: string;
  /** Space-separated scopes requested for the M2M token. */
  scopes: string;
  requestTimeoutMs: number;
  concurrency: number;
  retry: RetryConfig;
  /** Default `pageSize` for `GET /v1/users` (1–1000). */
  defaultPageSize: number;
  /** Refresh the cached token this many ms before it actually expires. */
  tokenRefreshSkewMs: number;
};

export type DeepIdApiConfigInput = {
  identityBaseUrl: string;
  appBaseUrl: string;
  clientId: string;
  clientSecret: string;
  scopes?: string;
  requestTimeoutMs?: number;
  concurrency?: number;
  retry?: Partial<RetryConfig>;
  defaultPageSize?: number;
  tokenRefreshSkewMs?: number;
  /** Pino log level; pass from the consuming app's validated env. Defaults to 'info'. */
  logLevel?: string;
};

export const DEFAULT_CONFIG: Omit<DeepIdApiConfig, 'identityBaseUrl' | 'appBaseUrl' | 'clientId' | 'clientSecret'> = {
  scopes: 'api wallets post_scores',
  requestTimeoutMs: 30_000,
  concurrency: 4,
  retry: {
    maxAttempts: 5,
    baseDelayMs: 500,
    maxDelayMs: 20_000,
  },
  defaultPageSize: 500,
  tokenRefreshSkewMs: 60_000,
};
