import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ENTITIES } from '../../../src/persistence/entities';
import { startTestDatabase, type TestDatabase } from '../../utils/postgres-testcontainer';

describe('TypeORM bootstrap smoke', () => {
  let db: TestDatabase;
  let dataSource: DataSource;

  beforeAll(async () => {
    db = await startTestDatabase();
    dataSource = new DataSource({
      type: 'postgres',
      url: db.databaseUrl,
      entities: [...ENTITIES],
      namingStrategy: new SnakeNamingStrategy(),
      synchronize: false,
      logging: false,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
    await db?.stop();
  });

  it('exposes the DataSource surface used by repositories', () => {
    expect(typeof dataSource.query).toBe('function');
    expect(typeof dataSource.transaction).toBe('function');
    expect(typeof dataSource.getRepository).toBe('function');
    expect(dataSource.isInitialized).toBe(true);
  });

  it('runs raw SQL queries against the testcontainer', async () => {
    const rows = (await dataSource.query('SELECT 1 as one')) as Array<{ one: number | string }>;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].one)).toBe(1);
  });

  it('has the canonical snake_case `snapshots` table in PG', async () => {
    const rows = (await dataSource.query(`SELECT to_regclass('public.snapshots') IS NOT NULL AS exists`)) as Array<{
      exists: boolean;
    }>;
    expect(rows[0]?.exists).toBe(true);
  });
});
