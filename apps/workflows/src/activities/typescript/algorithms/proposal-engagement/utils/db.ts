import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Storage } from '@reputo/storage';

import config from '../../../../../config/index.js';
import { getDeepfundingDbKey } from '../../../../../shared/constants/index.js';

export async function createDeepFundingDb(snapshotId: string, storage: Storage): Promise<string> {
  const deepfundingDbKey = getDeepfundingDbKey(snapshotId);
  const dbBytes = await storage.getObject({
    bucket: config.storage.bucket,
    key: deepfundingDbKey,
  });
  const tempDir = await mkdtemp(join(tmpdir(), `reputo-deepfundingdb-${snapshotId}-`));
  const localDbPath = join(tempDir, 'deepfunding.db');
  await writeFile(localDbPath, dbBytes);
  return localDbPath;
}
