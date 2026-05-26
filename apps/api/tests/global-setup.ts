import { applyAuthTestEnv } from './utils/auth-session';
import { startTestDatabase, type TestDatabase } from './utils/postgres-testcontainer';

let database: TestDatabase | undefined;

export default async function setup() {
  process.env.NODE_ENV = 'test';
  process.env.AWS_REGION ??= 'us-east-1';
  process.env.STORAGE_BUCKET ??= 'reputo-test';
  process.env.TEMPORAL_ADDRESS ??= 'localhost:7233';
  applyAuthTestEnv();

  database = await startTestDatabase();
  process.env.DATABASE_URL = database.databaseUrl;

  return async () => {
    await database?.stop();
    database = undefined;
  };
}
