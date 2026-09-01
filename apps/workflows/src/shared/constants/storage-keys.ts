export const DEEPFUNDING_DB_FILENAME = 'deepfunding.db';

export function getDeepfundingDbKey(snapshotId: string): string {
  return `snapshots/${snapshotId}/${DEEPFUNDING_DB_FILENAME}`;
}

export const COMMUNITY_ACTIVITIES_FILENAME = 'activities.parquet';
export const COMMUNITY_COHORT_FILENAME = 'cohort.parquet';
export const COMMUNITY_COVERAGE_FILENAME = 'coverage.parquet';
export const COMMUNITY_MANIFEST_FILENAME = 'manifest.json';

/**
 * Community datasets live under the snapshot prefix
 * (`snapshots/{id}/community_{platform}/...`), so snapshot deletion covers
 * them and no other durable copies exist.
 */
export function getCommunityDatasetPrefix(snapshotId: string, platform: string): string {
  return `snapshots/${snapshotId}/community_${platform}`;
}

export function getCommunityDatasetKey(snapshotId: string, platform: string, filename: string): string {
  return `${getCommunityDatasetPrefix(snapshotId, platform)}/${filename}`;
}

/** Resumable crawl segments; deleted once the manifest commits the dataset. */
export function getCommunityStagingPrefix(snapshotId: string, platform: string): string {
  return `${getCommunityDatasetPrefix(snapshotId, platform)}/staging/`;
}
