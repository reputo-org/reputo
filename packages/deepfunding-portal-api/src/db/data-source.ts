import 'reflect-metadata';

import { DataSource, type DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { ENTITIES } from './entities/index.js';
import { MIGRATIONS } from './migrations/index.js';

/**
 * Build TypeORM `DataSourceOptions` for the DeepFunding Portal SQLite database.
 *
 * The package is consumed by short-lived activities (sync, compute) that open a
 * fresh DB and tear it down at the end. To keep the runtime DataSource and the
 * CLI DataSource (used by `typeorm migration:*`) consistent, both go through
 * this builder. `synchronize` stays `false`: schema is created by the init
 * migration so we don't drift from the SQL the migration runs.
 */
export function buildDataSourceOptions(databasePath: string): DataSourceOptions {
  return {
    type: 'better-sqlite3',
    database: databasePath,
    entities: [...ENTITIES],
    migrations: [...MIGRATIONS],
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    logging: false,
  };
}

/**
 * Standalone TypeORM `DataSource` used by the CLI (`typeorm migration:generate`,
 * `migration:run`). The runtime DataSource produced by `createDb` mirrors these
 * options exactly so generated SQL stays consistent with what the package opens
 * at sync time.
 *
 * `DEEPFUNDING_DB_PATH` lets the CLI point at a real file when generating or
 * inspecting migrations; tests and the workflows activity bypass this by
 * calling `createDb` directly with their own path.
 */
const cliDatabasePath = process.env.DEEPFUNDING_DB_PATH ?? ':memory:';

export const AppDataSource = new DataSource(buildDataSourceOptions(cliDatabasePath));

export default AppDataSource;
