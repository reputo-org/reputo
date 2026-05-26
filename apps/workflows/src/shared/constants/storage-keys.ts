export const DEEPFUNDING_DB_FILENAME = 'deepfunding.db';

export function getDeepfundingDbKey(snapshotId: string): string {
  return `snapshots/${snapshotId}/${DEEPFUNDING_DB_FILENAME}`;
}
