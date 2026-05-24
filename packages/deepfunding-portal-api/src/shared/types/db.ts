import type { DataSource } from 'typeorm';

export type CreateDbOptions = {
  /** Path to the SQLite database file. Use `:memory:` for an in-memory store. */
  path: string;
};

export type DeepFundingPortalDb = {
  dataSource: DataSource;
};
