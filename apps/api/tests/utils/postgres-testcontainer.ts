import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { ENTITIES } from '../../src/persistence/entities';
import { MIGRATIONS } from '../../src/persistence/migrations';

export interface TestDatabase {
  databaseUrl: string;
  container: StartedPostgreSqlContainer;
  stop: () => Promise<void>;
}

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export { API_ROOT };

async function runTypeOrmMigrations(databaseUrl: string): Promise<void> {
  const dataSource = new DataSource({
    type: 'postgres',
    url: databaseUrl,
    entities: [...ENTITIES],
    migrations: [...MIGRATIONS],
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    logging: false,
  });

  try {
    await dataSource.initialize();
    await dataSource.runMigrations();
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

/**
 * Returns the shared testcontainer URL set by the e2e globalSetup hook. Throws
 * if the suite was not started under that config — guards against accidental
 * unit-test usage.
 */
export function getSharedDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || !(url.startsWith('postgresql://') || url.startsWith('postgres://'))) {
    throw new Error(
      'No shared testcontainer URL available. Did you forget to run via the e2e vitest config (globalSetup)?',
    );
  }
  return url;
}

export async function startTestDatabase(): Promise<TestDatabase> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('reputo_test')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();

  try {
    const databaseUrl = container.getConnectionUri();

    await runTypeOrmMigrations(databaseUrl);

    return {
      databaseUrl,
      container,
      stop: () => container.stop().then(() => undefined),
    };
  } catch (err) {
    await container.stop().catch(() => undefined);
    throw err;
  }
}
