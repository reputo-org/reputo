import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export interface TestDatabase {
  databaseUrl: string;
  container: StartedPostgreSqlContainer;
  stop: () => Promise<void>;
}

// Resolve paths relative to this file so the helper works regardless of which
// directory `vitest` was invoked from (e.g. repo root vs. `apps/api`).
const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCHEMA_PATH = path.join(API_ROOT, 'prisma/schema.prisma');
const MIGRATIONS_DIR = path.join(API_ROOT, 'prisma/migrations');

async function runPrismaMigrateDeploy(databaseUrl: string): Promise<void> {
  if (!existsSync(MIGRATIONS_DIR)) {
    // No migrations directory — nothing to apply. Allows the helper to be
    // imported in bootstrap scenarios where the schema is still empty.
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'prisma', 'migrate', 'deploy', '--schema', SCHEMA_PATH], {
      // `cwd` pins pnpm to the api workspace so it can resolve the local
      // `prisma` bin even when vitest is invoked from the repo root.
      cwd: API_ROOT,
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

  try {
    const databaseUrl = container.getConnectionUri();

    await runPrismaMigrateDeploy(databaseUrl);

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
