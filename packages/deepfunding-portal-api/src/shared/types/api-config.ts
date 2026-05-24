/**
 * Retry configuration for HTTP requests
 */
export type RetryConfig = {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Base delay in milliseconds for exponential backoff */
  baseDelayMs: number;
  /** Maximum delay in milliseconds between retries */
  maxDelayMs: number;
};

/**
 * Configuration for the DeepFunding Portal API client
 */
export type DeepFundingPortalApiConfig = {
  /** Base URL of the API (required) */
  baseUrl: string;
  /** API key for authentication (required) */
  apiKey: string;
  /** Request timeout in milliseconds (default: 45000) */
  requestTimeoutMs: number;
  /** Maximum concurrent requests (default: 4) */
  concurrency: number;
  /** Retry configuration */
  retry: RetryConfig;
  /** Default page limit for paginated requests (default: 500) */
  defaultPageLimit: number;
};

/**
 * Partial configuration for creating a client (baseUrl and apiKey are required)
 */
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

/**
 * Default configuration values
 */
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
