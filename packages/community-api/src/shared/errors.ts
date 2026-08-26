/** Platform error bodies are short JSON; the cap guards against HTML error pages. */
const BODY_SNIPPET_LENGTH = 200;

/**
 * Safe, platform-neutral classification of a failure. Callers map these onto
 * connection lifecycle states and audit rows; the values never carry a
 * platform response body.
 */
export const CommunityErrorCategory = {
  authFailed: 'auth_failed',
  permissionDenied: 'permission_denied',
  rateLimited: 'rate_limited',
  notFound: 'not_found',
  upstreamError: 'upstream_error',
  networkError: 'network_error',
  contractViolation: 'contract_violation',
} as const;

export type CommunityErrorCategory = (typeof CommunityErrorCategory)[keyof typeof CommunityErrorCategory];

export abstract class CommunityApiError extends Error {
  abstract readonly category: CommunityErrorCategory;
}

/** A non-2xx platform response that is neither an auth nor a rate-limit failure. */
export class CommunityHttpError extends CommunityApiError {
  readonly category: CommunityErrorCategory;

  constructor(
    readonly statusCode: number,
    statusText: string,
    body?: string,
  ) {
    const snippet = body && body.trim().length > 0 ? ` — ${body.trim().slice(0, BODY_SNIPPET_LENGTH)}` : '';
    super(`HTTP ${statusCode}: ${statusText}${snippet}`);
    this.name = 'CommunityHttpError';
    this.category = statusCode === 404 ? CommunityErrorCategory.notFound : CommunityErrorCategory.upstreamError;
  }
}

/** The platform rejected the credentials — a revoked bot, or a bad token. */
export class CommunityAuthError extends CommunityApiError {
  readonly category = CommunityErrorCategory.authFailed;

  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'CommunityAuthError';
  }
}

/** The credentials are valid but lack the permission this call needs. */
export class CommunityPermissionError extends CommunityApiError {
  readonly category = CommunityErrorCategory.permissionDenied;

  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'CommunityPermissionError';
  }
}

/** Rate limited after exhausting the configured retries. */
export class CommunityRateLimitError extends CommunityApiError {
  readonly category = CommunityErrorCategory.rateLimited;

  constructor(
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'CommunityRateLimitError';
  }
}

/** Transport failure: timeout, refused connection, reset socket. */
export class CommunityNetworkError extends CommunityApiError {
  readonly category = CommunityErrorCategory.networkError;

  constructor(message: string) {
    super(message);
    this.name = 'CommunityNetworkError';
  }
}

/**
 * A platform response that breaks the documented contract — a missing guild on
 * a bot token exchange, a channel list that is not an array. Messages describe
 * the expected shape only; they never contain response bodies.
 */
export class CommunityContractError extends CommunityApiError {
  readonly category = CommunityErrorCategory.contractViolation;

  constructor(message: string) {
    super(message);
    this.name = 'CommunityContractError';
  }
}

export function toErrorCategory(error: unknown): CommunityErrorCategory {
  return error instanceof CommunityApiError ? error.category : CommunityErrorCategory.upstreamError;
}
