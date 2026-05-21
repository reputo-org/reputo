import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export interface TestDatabase {
  databaseUrl: string;
  container: StartedPostgreSqlContainer;
  stop: () => Promise<void>;
}

const SCHEMA_PATH = path.resolve(process.cwd(), 'prisma/schema.prisma');
const MIGRATIONS_DIR = path.resolve(process.cwd(), 'prisma/migrations');

async function runPrismaMigrateDeploy(databaseUrl: string): Promise<void> {
  if (!existsSync(MIGRATIONS_DIR)) {
    // No migrations to apply yet (task 03 ships the bootstrap only).
    // Subsequent tasks add `prisma/migrations` and this branch falls away.
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'prisma', 'migrate', 'deploy', '--schema', SCHEMA_PATH], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`prisma migrate deploy exited with code ${code}`));
      }
    });
  });
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

  const databaseUrl = container.getConnectionUri();

  await runPrismaMigrateDeploy(databaseUrl);

  return {
    databaseUrl,
    container,
    stop: () => container.stop().then(() => undefined),
  };
}
