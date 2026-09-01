import type { CommunityPlatform } from '@reputo/contracts';

export type DependencyKey =
  | 'deepfunding-portal-api'
  | 'onchain-data'
  | 'deep-id'
  | 'discord-activity'
  | 'github-activity'
  | 'mattermost-activity';

/**
 * Dependency keys resolved on the single-slot community task queue. Each key
 * is one platform's activity fetch; later platforms add theirs here.
 */
export const COMMUNITY_DEPENDENCY_KEYS = ['discord-activity', 'github-activity', 'mattermost-activity'] as const;

export type CommunityDependencyKey = (typeof COMMUNITY_DEPENDENCY_KEYS)[number];

/** Each community platform's fetch is its own dependency key. */
export const COMMUNITY_PLATFORM_BY_DEPENDENCY_KEY: Record<CommunityDependencyKey, CommunityPlatform> = {
  'discord-activity': 'discord',
  'github-activity': 'github',
  'mattermost-activity': 'mattermost',
};

export function isCommunityDependencyKey(key: DependencyKey): key is CommunityDependencyKey {
  return (COMMUNITY_DEPENDENCY_KEYS as readonly DependencyKey[]).includes(key);
}

/**
 * What a community fetch dependency crawls, extracted from the frozen preset
 * by the orchestrator. The window is fixed at workflow start and identical on
 * every retry; the platform follows from the dependency key.
 */
export interface CommunityFetchInput {
  /** Reputo community connection id the preset references. */
  connectionId: string;
  /**
   * Platform-side community id — a Discord guild id, a GitHub installation id,
   * a Mattermost `{origin}/{teamId}` — resolved from the connection by the
   * orchestrator. The cohort's member lookup runs against it.
   */
  communityId: string;
  /** Selected resource ids — Discord channel ids, GitHub repository ids, Mattermost channel ids. */
  resourceIds: string[];
  /** Window start (inclusive), ISO 8601 UTC. */
  windowStart: string;
  /** Window end (exclusive), ISO 8601 UTC — the workflow start time. */
  windowEnd: string;
  /**
   * Sealed platform credential, for platforms that connect with an
   * admin-supplied token. The orchestrator reads it through the API's
   * `getCommunitySealedCredential` activity — the workers have no application
   * database — and it stays encrypted until the outbound call opens it.
   */
  credentialsCiphertext?: string;
}

/**
 * A chain+identifier pair that the onchain worker should sync.
 */
export interface SyncTarget {
  chain: string;
  identifier: string;
}

export interface ResolveDependencyInput {
  dependencyKey: DependencyKey;
  snapshotId: string;
  /** For onchain-data: which chain+identifier pairs to sync */
  syncTargets?: SyncTarget[];
  /** For community dependencies: what to crawl and the frozen window */
  communityFetch?: CommunityFetchInput;
}

/**
 * Result of resolving a dependency. A dependency that assembles the algorithm's
 * `dids` input (e.g. `deep-id`, which fetches consented users from DeepID)
 * returns the S3 key of the generated DID JSON so the orchestrator can point
 * the algorithm at it.
 */
export interface ResolveDependencyResult {
  didsKey?: string;
}

export interface DependencyResolverEntry {
  /** Function to resolve the dependency (uploads data to predictable S3 path) */
  resolve: (snapshotId: string) => Promise<void>;
}
