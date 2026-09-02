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
export type CommunityResourceKind = 'text' | 'announcement' | 'forum' | 'repository';

/** One selectable resource inside a connected community — a Discord channel, a GitHub repository. */
export interface CommunityResource {
  id: string;
  name: string;
  kind: CommunityResourceKind;
}

/**
 * Display facts about a connected community — counts and public asset URLs
 * only, in keeping with the package rule of never touching content.
 */
export interface CommunityProfile {
  /** Public HTTPS icon URL, when the platform serves one unauthenticated. */
  avatarUrl?: string;
  /** Approximate member count, when one cheap call provides it. */
  memberCount?: number;
}

/**
 * Outcome of a successful capability probe: what the connection can list, and
 * which resource one page of history was read from. A probe that resolves has
 * already verified the fields the fetch will later need.
 */
export interface CommunityProbeResult {
  resourceCount: number;
  /** Resource the probe read a page of history from, when one was readable. */
  sampledResourceId?: string;
  sampledRecordCount: number;
  /** Best-effort display facts; absent when the extra call failed. */
  profile?: CommunityProfile;
}

export const DEFAULT_HTTP_CONFIG: CommunityHttpConfig = {
  requestTimeoutMs: 15_000,
  retry: {
    maxAttempts: 4,
    baseDelayMs: 500,
    maxDelayMs: 10_000,
  },
};
