export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

/** Transport settings every platform client shares. Injected, never read from the environment. */
export interface CommunityHttpConfig {
  requestTimeoutMs: number;
  retry: RetryConfig;
}

/** Canonical, platform-neutral kinds of a selectable resource. */
export type CommunityResourceKind = 'text' | 'announcement' | 'forum';

/** One selectable resource inside a connected community — a Discord channel. */
export interface CommunityResource {
  id: string;
  name: string;
  kind: CommunityResourceKind;
}

/**
 * Outcome of a capability probe: what the connection can list, and whether one
 * page of history carried the fields the fetch will later need.
 */
export interface CommunityProbeResult {
  resourceCount: number;
  /** Resource the probe read a page of history from, when one was readable. */
  sampledResourceId?: string;
  sampledRecordCount: number;
  /** False when a sampled record was missing an id, author id, or timestamp. */
  requiredFieldsPresent: boolean;
}

export const DEFAULT_HTTP_CONFIG: CommunityHttpConfig = {
  requestTimeoutMs: 15_000,
  retry: {
    maxAttempts: 4,
    baseDelayMs: 500,
    maxDelayMs: 10_000,
  },
};
