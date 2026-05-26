import { closeDbInstance, createDb, type DeepFundingPortalDb } from '../../src/db/client.js';

export async function createTestDb(): Promise<DeepFundingPortalDb> {
  return createDb({ path: ':memory:' });
}

export async function cleanupTestDb(db: DeepFundingPortalDb): Promise<void> {
  await closeDbInstance(db);
}

export async function execSql(db: DeepFundingPortalDb, sql: string): Promise<void> {
  await db.dataSource.query(sql);
}

export async function tableExists(db: DeepFundingPortalDb, tableName: string): Promise<boolean> {
  const rows = (await db.dataSource.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [
    tableName,
  ])) as Array<{ name: string }>;
  return rows.length > 0;
}

/**
 * Return user-defined table names — excludes the TypeORM `migrations`
 * bookkeeping table and SQLite-internal `sqlite_%` tables.
 */
export async function getTableNames(db: DeepFundingPortalDb): Promise<string[]> {
  const rows = (await db.dataSource.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'migrations'",
  )) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

export async function getIndexNames(db: DeepFundingPortalDb, likePattern: string): Promise<string[]> {
  const rows = (await db.dataSource.query("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE ?", [
    likePattern,
  ])) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

export async function getColumnInfo(
  db: DeepFundingPortalDb,
  tableName: string,
): Promise<Array<{ name: string; type: string; pk: number }>> {
  return (await db.dataSource.query(`PRAGMA table_info("${tableName}")`)) as Array<{
    name: string;
    type: string;
    pk: number;
  }>;
}
