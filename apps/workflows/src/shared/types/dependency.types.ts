export type DependencyKey = 'deepfunding-portal-api' | 'onchain-data' | 'deep-id' | 'discord-activity';

/**
 * Dependency keys resolved on the single-slot community task queue. Each key
 * is one platform's activity fetch; later platforms add theirs here.
 */
export const COMMUNITY_DEPENDENCY_KEYS = ['discord-activity'] as const;

export type CommunityDependencyKey = (typeof COMMUNITY_DEPENDENCY_KEYS)[number];

export function isCommunityDependencyKey(key: DependencyKey): key is CommunityDependencyKey {
  return (COMMUNITY_DEPENDENCY_KEYS as readonly DependencyKey[]).includes(key);
}

/**
 * What a community fetch dependency crawls, extracted from the frozen preset
 * by the orchestrator. The window is fixed at workflow start and identical on
 * every retry; the platform follows from the dependency key.
 */
export interface CommunityFetchInput {
  /** Selected resource ids — Discord channel ids. */
  resourceIds: string[];
  /** Window start (inclusive), ISO 8601 UTC. */
  windowStart: string;
  /** Window end (exclusive), ISO 8601 UTC — the workflow start time. */
  windowEnd: string;
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
