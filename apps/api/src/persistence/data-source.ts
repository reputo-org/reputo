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
