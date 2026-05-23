import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { env } from '../config/env';
import { ENTITIES } from './entities';
import { MIGRATIONS } from './migrations';

const databaseUrl = env.DATABASE_URL;

/**
 * Standalone TypeORM `DataSource` used by the CLI (`typeorm migration:generate`,
 * `migration:run`, etc.). The runtime DataSource registered via
 * `TypeOrmModule.forRootAsync` mirrors these options exactly so generated SQL
 * stays consistent with what the app sees at boot.
 *
 * `synchronize` is hard-coded to `false`: schema changes always go through a
 * generated migration so production runs are deterministic.
 */
// Single export: the TypeORM CLI (both `typeorm-ts-node-commonjs` for the TS
// source and `typeorm` for the compiled JS) requires exactly one DataSource
// export per file. Exposing the same instance under two names trips
// `loadDataSource` with "Given data source file must contain only one export
// of DataSource instance". External consumers import the named alias from
// `./index.ts`.
const AppDataSource = new DataSource({
  type: 'postgres',
  url: databaseUrl,
  entities: [...ENTITIES],
  migrations: [...MIGRATIONS],
  namingStrategy: new SnakeNamingStrategy(),
  synchronize: false,
  logging: false,
});

export default AppDataSource;
