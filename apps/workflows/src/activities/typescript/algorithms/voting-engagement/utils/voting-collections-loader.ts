import type { Storage } from '@reputo/storage';
import { parse } from 'csv-parse/sync';

interface WalletCollectionRow {
  collection_id?: string;
  address?: string;
}

/**
 * Loads the wallet collections CSV (DEEP Voting Portal export) and indexes it as
 * `wallet address → collection_id[]`. Wallet addresses are lower-cased so they
 * match the wallets that come from DeepID. A wallet may map to more than one
 * collection.
 */
export async function loadWalletCollectionIndex(
  storage: Storage,
  bucket: string,
  key: string,
): Promise<Map<string, string[]>> {
  const buffer = await storage.getObject({ bucket, key });
  const rows = parse(buffer.toString('utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as WalletCollectionRow[];

  const index = new Map<string, string[]>();
  for (const row of rows) {
    const collectionId = row.collection_id?.trim();
    const wallet = row.address?.trim().toLowerCase();
    if (!collectionId || !wallet) {
      continue;
    }

    const collections = index.get(wallet) ?? [];
    if (!collections.includes(collectionId)) {
      collections.push(collectionId);
    }
    index.set(wallet, collections);
  }

  return index;
}
