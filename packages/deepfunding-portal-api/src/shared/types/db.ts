import type { DataSource } from 'typeorm';

/**
 * Options for creating a new database
 */
export type CreateDbOptions = {
  /** Path to the SQLite database file. Use `:memory:` for an in-memory store. */
  path: string;
};

/**
 * DeepFunding Portal database wrapper.
 *
 * Wraps an initialized TypeORM `DataSource` against a SQLite file. Repositories
 * are constructed against this single instance via `createRepos`.
 */
export type DeepFundingPortalDb = {
  /** Initialized TypeORM data source backed by `better-sqlite3`. */
  dataSource: DataSource;
};
