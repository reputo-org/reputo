import { closeDbInstance, createDb, type DeepFundingPortalDb } from '../../src/db/client.js';

/**
 * Create an in-memory database for testing
 */
export async function createTestDb(): Promise<DeepFundingPortalDb> {
  return createDb({ path: ':memory:' });
}

/**
 * Clean up test database
 */
export async function cleanupTestDb(db: DeepFundingPortalDb): Promise<void> {
  await closeDbInstance(db);
}

/**
 * Execute SQL directly against the underlying SQLite connection.
 */
export async function execSql(db: DeepFundingPortalDb, sql: string): Promise<void> {
  await db.dataSource.query(sql);
}

/**
 * Check if a table exists in the database.
 */
export async function tableExists(db: DeepFundingPortalDb, tableName: string): Promise<boolean> {
  const rows = (await db.dataSource.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [
    tableName,
  ])) as Array<{ name: string }>;
  return rows.length > 0;
}

/**
 * Get all user-defined table names in the database (excluding the TypeORM
 * `migrations` bookkeeping table and SQLite-internal tables).
 */
export async function getTableNames(db: DeepFundingPortalDb): Promise<string[]> {
  const rows = (await db.dataSource.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'migrations'",
  )) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/**
 * List indexes whose name matches the given LIKE pattern (e.g. `idx_%`).
 */
export async function getIndexNames(db: DeepFundingPortalDb, likePattern: string): Promise<string[]> {
  const rows = (await db.dataSource.query("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE ?", [
    likePattern,
  ])) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

/**
 * Fetch the column metadata that SQLite stores for a given table.
 */
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
