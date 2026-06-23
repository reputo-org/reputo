export type DependencyKey = 'deepfunding-portal-api' | 'onchain-data' | 'deep-id';

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
