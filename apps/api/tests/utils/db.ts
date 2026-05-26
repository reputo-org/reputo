import type { TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Resolves the default TypeORM `DataSource` from a NestJS testing module.
 * Centralized so tests don't have to remember the injection token, and so
 * a future multi-DS setup has exactly one place to update.
 */
export function getTestDataSource(moduleRef: TestingModule): DataSource {
  return moduleRef.get<DataSource>(getDataSourceToken());
}

const PG_DEADLOCK_DETECTED = '40P01';
const TRUNCATE_MAX_ATTEMPTS = 5;

async function runTruncate(dataSource: DataSource, tables: readonly string[]): Promise<void> {
  const sql = `TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`;
  for (let attempt = 1; attempt <= TRUNCATE_MAX_ATTEMPTS; attempt++) {
    try {
      await dataSource.query(sql);
      return;
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== PG_DEADLOCK_DETECTED || attempt === TRUNCATE_MAX_ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** (attempt - 1)));
    }
  }
}

/**
 * Truncates every table the API owns, restarting identity sequences and
 * cascading FKs. Cheap reset for suites that need a fully empty DB.
 *
 * Most suites authenticate once in `beforeAll` and want to keep the session
 * row across tests — those should use `truncateBusinessTables` instead.
 */
export async function truncateAllTables(dataSource: DataSource): Promise<void> {
  await runTruncate(dataSource, [
    'access_allowlist',
    'auth_sessions',
    'oauth_users',
    'oauth_consent_grants',
    'snapshot_outputs',
    'snapshots',
    'algorithm_preset_inputs',
    'algorithm_presets',
  ]);
}

/**
 * Truncates only the business-data tables (snapshots, algorithm presets, and
 * their child rows). Preserves the auth/admin tables so a session seeded in
 * `beforeAll` survives across `afterEach` resets — matches the cleanup
 * scope of the original Prisma-era e2e suites.
 */
export async function truncateBusinessTables(dataSource: DataSource): Promise<void> {
  await runTruncate(dataSource, ['snapshot_outputs', 'snapshots', 'algorithm_preset_inputs', 'algorithm_presets']);
}
