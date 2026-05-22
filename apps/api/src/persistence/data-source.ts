import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { ENTITIES } from './entities';
import { MIGRATIONS } from './migrations';

const databaseUrl = process.env.DATABASE_URL;

/**
 * Standalone TypeORM `DataSource` used by the CLI (`typeorm migration:generate`,
 * `migration:run`, etc.). The runtime DataSource registered via
 * `TypeOrmModule.forRootAsync` mirrors these options exactly so generated SQL
 * stays consistent with what the app sees at boot.
 *
 * `synchronize` is hard-coded to `false`: schema changes always go through a
 * generated migration so production runs are deterministic.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  url: databaseUrl,
  entities: [...ENTITIES],
  migrations: [...MIGRATIONS],
  namingStrategy: new SnakeNamingStrategy(),
  synchronize: false,
  logging: false,
});

// `typeorm-ts-node-commonjs` picks up the default export when given a `.ts`
// path, so re-export here in addition to the named export.
export default AppDataSource;
