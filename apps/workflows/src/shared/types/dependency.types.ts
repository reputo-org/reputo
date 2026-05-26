export type DependencyKey = 'deepfunding-portal-api' | 'onchain-data';

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

export interface DependencyResolverEntry {
  /** Function to resolve the dependency (uploads data to predictable S3 path) */
  resolve: (snapshotId: string) => Promise<void>;
}
