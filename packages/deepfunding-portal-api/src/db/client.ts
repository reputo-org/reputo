import 'reflect-metadata';

import { DataSource } from 'typeorm';
import type { CreateDbOptions, DeepFundingPortalDb as DeepFundingPortalDbType } from '../shared/types/db.js';
import { buildDataSourceOptions } from './data-source.js';

export type {
  CreateDbOptions,
  DeepFundingPortalDb,
} from '../shared/types/db.js';

/**
 * Create an independent database instance.
 *
 * Each call initializes a fresh `DataSource` against the provided SQLite path
 * and runs the init migration so the schema is ready before any repository
 * operation. Independent instances do not share connection state, making them
 * safe for concurrent algorithm executions.
 *
 * Callers are responsible for closing the instance via {@link closeDbInstance}.
 */
export async function createDb(options: CreateDbOptions): Promise<DeepFundingPortalDbType> {
  const dataSource = new DataSource(buildDataSourceOptions(options.path));

  try {
    await dataSource.initialize();
    await dataSource.runMigrations();
    return { dataSource };
  } catch (error) {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
    throw error;
  }
}

/**
 * Close a specific database instance returned by {@link createDb}.
 */
export async function closeDbInstance(db: DeepFundingPortalDbType): Promise<void> {
  if (db.dataSource.isInitialized) {
    await db.dataSource.destroy();
  }
}
