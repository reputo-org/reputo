export type RetryConfig = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export type DeepFundingPortalApiConfig = {
  baseUrl: string;
  apiKey: string;
  requestTimeoutMs: number;
  concurrency: number;
  retry: RetryConfig;
  defaultPageLimit: number;
};

export type DeepFundingPortalApiConfigInput = {
  baseUrl: string;
  apiKey: string;
  requestTimeoutMs?: number;
  concurrency?: number;
  retry?: Partial<RetryConfig>;
  defaultPageLimit?: number;
  /** Pino log level; pass from the consuming app's validated env. Defaults to 'info'. */
  logLevel?: string;
};

export const DEFAULT_CONFIG: Omit<DeepFundingPortalApiConfig, 'baseUrl' | 'apiKey'> = {
  requestTimeoutMs: 10000,
  concurrency: 1,
  retry: {
    maxAttempts: 7,
    baseDelayMs: 500,
    maxDelayMs: 10000,
  },
  defaultPageLimit: 500,
};
