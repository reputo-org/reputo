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

/**
 * Truncates every table the API owns, restarting identity sequences and
 * cascading FKs. Cheap reset for suites that need a fully empty DB.
 *
 * Most suites authenticate once in `beforeAll` and want to keep the session
 * row across tests — those should use `truncateBusinessTables` instead.
 */
export async function truncateAllTables(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    'TRUNCATE TABLE ' +
      [
        'access_allowlist',
        'auth_sessions',
        'oauth_users',
        'oauth_consent_grants',
        'snapshot_outputs',
        'snapshots',
        'algorithm_preset_inputs',
        'algorithm_presets',
      ].join(', ') +
      ' RESTART IDENTITY CASCADE',
  );
}

/**
 * Truncates only the business-data tables (snapshots, algorithm presets, and
 * their child rows). Preserves the auth/admin tables so a session seeded in
 * `beforeAll` survives across `afterEach` resets — matches the cleanup
 * scope of the original Prisma-era e2e suites.
 */
export async function truncateBusinessTables(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    'TRUNCATE TABLE ' +
      ['snapshot_outputs', 'snapshots', 'algorithm_preset_inputs', 'algorithm_presets'].join(', ') +
      ' RESTART IDENTITY CASCADE',
  );
}
