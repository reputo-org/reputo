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

// Resolve paths relative to this file so the helper works regardless of which
// directory `vitest` was invoked from (e.g. repo root vs. `apps/api`).
const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// Re-exported for callers that want to introspect or extend the bootstrap.
export { API_ROOT };

async function runTypeOrmMigrations(databaseUrl: string): Promise<void> {
  // Spin up a transient DataSource so we exercise the same migration runner
  // path the production app uses. `synchronize: false` here is critical —
  // tests must catch schema drift relative to the committed migration.
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

// Starts a fresh PostgreSQL container per call so each test suite gets a
// hermetic database. Callers must invoke `stop()` in `afterAll` to free the
// container; nothing is shared across suites.
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
    // If migration (or anything after `start`) fails, the container would
    // otherwise be orphaned because the caller never receives a `stop()`.
    await container.stop().catch(() => undefined);
    throw err;
  }
}
