import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { beforeAll } from 'vitest';
import { ENTITIES } from '../src/persistence/entities';
import { applyAuthTestEnv } from './utils/auth-session';
import { truncateAllTables } from './utils/db';
import { getSharedDatabaseUrl } from './utils/postgres-testcontainer';

applyAuthTestEnv();

beforeAll(async () => {
  const dataSource = new DataSource({
    type: 'postgres',
    url: getSharedDatabaseUrl(),
    entities: [...ENTITIES],
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
    logging: false,
  });
  await dataSource.initialize();
  try {
    await truncateAllTables(dataSource);
  } finally {
    await dataSource.destroy();
  }
});
