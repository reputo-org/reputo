import type { Storage } from '@reputo/storage';
import { parse } from 'csv-parse/sync';

import type { VoteRecord } from '../../../../../shared/types/index.js';

export async function loadVotes(storage: Storage, bucket: string, key: string): Promise<VoteRecord[]> {
  const buffer = await storage.getObject({ bucket, key });
  const csvText = buffer.toString('utf8');

  return parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as VoteRecord[];
}
