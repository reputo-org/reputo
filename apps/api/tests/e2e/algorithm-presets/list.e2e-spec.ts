import type { INestApplication } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { insertAlgorithmPreset, randomAlgorithmPreset } from '../../factories/algorithmPreset.factory';
import { createTestApp } from '../../utils/app-test.module';
import { createAuthenticatedSession } from '../../utils/auth-session';
import { getTestDataSource, truncateBusinessTables } from '../../utils/db';
import { assertPaginationMath, assertPaginationStructure } from '../../utils/pagination';
import { startTestDatabase, type TestDatabase } from '../../utils/postgres-testcontainer';
import { api } from '../../utils/request';

describe('GET /api/v1/algorithm-presets', () => {
  let app: INestApplication;
  let authCookie: string;
  let dataSource: DataSource;
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.databaseUrl;
    const boot = await createTestApp({});
    app = boot.app;
    dataSource = getTestDataSource(boot.moduleRef);
    authCookie = (await createAuthenticatedSession(boot.moduleRef)).cookie;
  });

  afterEach(async () => {
    await truncateBusinessTables(dataSource);
  });

  afterAll(async () => {
    await app.close();
    await db?.stop();
  });

  it('should list presets with default pagination (200) and PaginationDto shape', async () => {
    for (let i = 0; i < 15; i++) {
      await insertAlgorithmPreset(dataSource, randomAlgorithmPreset());
    }

    const res = await api(app, authCookie).get('/algorithm-presets').expect(200);

    assertPaginationStructure(res.body);

    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(10);
    expect(res.body.results).toHaveLength(10);
    expect(res.body.totalResults).toBe(15);
    expect(res.body.totalPages).toBe(2);

    assertPaginationMath(res.body);

    for (const preset of res.body.results) {
      expect(preset).toHaveProperty('_id');
      expect(preset).toHaveProperty('key');
      expect(preset).toHaveProperty('version');
      expect(preset).toHaveProperty('inputs');
      expect(preset).toHaveProperty('createdAt');
      expect(preset).toHaveProperty('updatedAt');
    }
  });

  it('should respect limit and page query params (200)', async () => {
    for (let i = 0; i < 25; i++) {
      await insertAlgorithmPreset(dataSource, randomAlgorithmPreset());
    }

    const res = await api(app, authCookie).get('/algorithm-presets?page=2&limit=5').expect(200);

    assertPaginationStructure(res.body);
    expect(res.body.page).toBe(2);
    expect(res.body.limit).toBe(5);
    expect(res.body.results).toHaveLength(5);
    expect(res.body.totalResults).toBe(25);
    expect(res.body.totalPages).toBe(5);
  });

  it('should sort by createdAt:desc (200)', async () => {
    await insertAlgorithmPreset(dataSource, { key: 'preset_1' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await insertAlgorithmPreset(dataSource, { key: 'preset_2' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await insertAlgorithmPreset(dataSource, { key: 'preset_3' });

    const res = await api(app, authCookie).get('/algorithm-presets').expect(200);

    expect(res.body.results[0].key).toBe('preset_3');
    expect(res.body.results[1].key).toBe('preset_2');
    expect(res.body.results[2].key).toBe('preset_1');
  });

  it('should support multiple sort fields via sortBy (200)', async () => {
    await insertAlgorithmPreset(dataSource, { key: 'a_key', version: '1.0.0' });
    await insertAlgorithmPreset(dataSource, { key: 'z_key', version: '1.0.0' });
    await insertAlgorithmPreset(dataSource, { key: 'a_key', version: '2.0.0' });

    const res = await api(app, authCookie).get('/algorithm-presets?sortBy=key:asc,version:desc').expect(200);

    expect(res.body.results[0].version).toBe('2.0.0');
    expect(res.body.results[1].version).toBe('1.0.0');
    expect(res.body.results[2].key).toBe('z_key');
  });

  it('should filter by key (200)', async () => {
    await insertAlgorithmPreset(dataSource, { key: 'target_key' });
    await insertAlgorithmPreset(dataSource, { key: 'other_key' });
    await insertAlgorithmPreset(dataSource, { key: 'target_key' });

    const res = await api(app, authCookie).get('/algorithm-presets?key=target_key').expect(200);

    expect(res.body.totalResults).toBe(2);
    for (const preset of res.body.results) {
      expect(preset.key).toBe('target_key');
    }
  });

  it('should filter by version (200)', async () => {
    await insertAlgorithmPreset(dataSource, { version: '2.0.0' });
    await insertAlgorithmPreset(dataSource, { version: '1.0.0' });
    await insertAlgorithmPreset(dataSource, { version: '2.0.0' });

    const res = await api(app, authCookie).get('/algorithm-presets?version=2.0.0').expect(200);

    expect(res.body.totalResults).toBe(2);
    for (const preset of res.body.results) {
      expect(preset.version).toBe('2.0.0');
    }
  });

  it('should return empty results when filters match nothing (200)', async () => {
    await insertAlgorithmPreset(dataSource, { key: 'key_1' });
    await insertAlgorithmPreset(dataSource, { key: 'key_2' });

    const res = await api(app, authCookie).get('/algorithm-presets?key=non_existent_key').expect(200);

    assertPaginationStructure(res.body);
    expect(res.body.results).toEqual([]);
    expect(res.body.totalResults).toBe(0);
    expect(res.body.totalPages).toBe(0);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(10);
  });
});
