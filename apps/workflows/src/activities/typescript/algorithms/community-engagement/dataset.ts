import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectNotFoundError, type Storage } from '@reputo/storage';
import {
  COMMUNITY_ACTIVITIES_FILENAME,
  COMMUNITY_COHORT_FILENAME,
  COMMUNITY_COVERAGE_FILENAME,
  COMMUNITY_MANIFEST_FILENAME,
  getCommunityDatasetKey,
} from '../../../../shared/constants/index.js';
import type { CommunityDatasetManifest } from '../../../community/index.js';

export interface LocalCommunityDataset {
  manifest: CommunityDatasetManifest;
  activitiesPath: string;
  cohortPath: string;
  coveragePath: string;
  /** Scratch root; remove it when scoring is done. */
  scratch: string;
}

const sha256 = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');

/**
 * Downloads the frozen community dataset into scratch and verifies every file
 * against the manifest hashes — scoring must only ever read the committed,
 * unmodified dataset. Throws a clear error when the manifest is missing (the
 * fetch dependency never committed) or predates the cohort file.
 */
export async function downloadCommunityDataset(args: {
  snapshotId: string;
  platform: string;
  storage: Storage;
  bucket: string;
  heartbeat: () => void;
}): Promise<LocalCommunityDataset> {
  const { snapshotId, platform, storage, bucket, heartbeat } = args;

  let manifestRaw: Buffer;
  try {
    manifestRaw = await storage.getObject({
      bucket,
      key: getCommunityDatasetKey(snapshotId, platform, COMMUNITY_MANIFEST_FILENAME),
    });
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      throw new Error(
        `Community ${platform} dataset for snapshot ${snapshotId} is not committed; the fetch dependency must run first`,
      );
    }
    throw error;
  }
  const manifest = JSON.parse(manifestRaw.toString('utf-8')) as CommunityDatasetManifest;

  const filenames = [COMMUNITY_ACTIVITIES_FILENAME, COMMUNITY_COHORT_FILENAME, COMMUNITY_COVERAGE_FILENAME];
  for (const filename of filenames) {
    if (manifest.files[filename] === undefined) {
      throw new Error(
        `Community ${platform} dataset for snapshot ${snapshotId} has no ${filename} (schema version ${manifest.schemaVersion}); re-run the snapshot`,
      );
    }
  }

  const scratch = await mkdtemp(join(tmpdir(), `reputo-community-score-${snapshotId}-`));
  try {
    const paths: Record<string, string> = {};
    for (const filename of filenames) {
      const body = await storage.getObject({ bucket, key: getCommunityDatasetKey(snapshotId, platform, filename) });
      if (sha256(body) !== manifest.files[filename].sha256) {
        throw new Error(
          `Community ${platform} dataset for snapshot ${snapshotId} failed hash verification on ${filename}`,
        );
      }
      const local = join(scratch, filename);
      await writeFile(local, body);
      paths[filename] = local;
      heartbeat();
    }

    return {
      manifest,
      activitiesPath: paths[COMMUNITY_ACTIVITIES_FILENAME],
      cohortPath: paths[COMMUNITY_COHORT_FILENAME],
      coveragePath: paths[COMMUNITY_COVERAGE_FILENAME],
      scratch,
    };
  } catch (error) {
    await rm(scratch, { recursive: true, force: true });
    throw error;
  }
}
