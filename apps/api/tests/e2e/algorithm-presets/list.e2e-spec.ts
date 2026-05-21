import type { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../../src/persistence';
import { insertAlgorithmPreset, randomAlgorithmPreset } from '../../factories/algorithmPreset.factory';
import { createTestApp } from '../../utils/app-test.module';
import { createAuthenticatedSession } from '../../utils/auth-session';
import { startMongo, stopMongo } from '../../utils/mongo-memory-server';
import { assertPaginationMath, assertPaginationStructure } from '../../utils/pagination';
import { startTestDatabase, type TestDatabase } from '../../utils/postgres-testcontainer';
import { api } from '../../utils/request';

describe('GET /api/v1/algorithm-presets', () => {
  let app: INestApplication;
  let authCookie: string;
  let prisma: PrismaService;
  let db: TestDatabase;

  beforeAll(async () => {
    const uri = await startMongo();
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.databaseUrl;
    const boot = await createTestApp({ mongoUri: uri });
    app = boot.app;
    prisma = boot.moduleRef.get(PrismaService);
    authCookie = (await createAuthenticatedSession(boot.moduleRef)).cookie;
  });

  afterEach(async () => {
    await prisma.snapshot.deleteMany({});
    await prisma.algorithmPreset.deleteMany({});
  });

  afterAll(async () => {
    await app.close();
    await stopMongo();
    await db?.stop();
  });

  it('should list presets with default pagination (200) and PaginationDto shape', async () => {
    for (let i = 0; i < 15; i++) {
      await insertAlgorithmPreset(prisma, randomAlgorithmPreset());
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
      await insertAlgorithmPreset(prisma, randomAlgorithmPreset());
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
    await insertAlgorithmPreset(prisma, { key: 'preset_1' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await insertAlgorithmPreset(prisma, { key: 'preset_2' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await insertAlgorithmPreset(prisma, { key: 'preset_3' });

    const res = await api(app, authCookie).get('/algorithm-presets').expect(200);

    expect(res.body.results[0].key).toBe('preset_3');
    expect(res.body.results[1].key).toBe('preset_2');
    expect(res.body.results[2].key).toBe('preset_1');
  });

  it('should support multiple sort fields via sortBy (200)', async () => {
    await insertAlgorithmPreset(prisma, { key: 'a_key', version: '1.0.0' });
    await insertAlgorithmPreset(prisma, { key: 'z_key', version: '1.0.0' });
    await insertAlgorithmPreset(prisma, { key: 'a_key', version: '2.0.0' });

    const res = await api(app, authCookie).get('/algorithm-presets?sortBy=key:asc,version:desc').expect(200);

    expect(res.body.results[0].version).toBe('2.0.0');
    expect(res.body.results[1].version).toBe('1.0.0');
    expect(res.body.results[2].key).toBe('z_key');
  });

  it('should filter by key (200)', async () => {
    await insertAlgorithmPreset(prisma, { key: 'target_key' });
    await insertAlgorithmPreset(prisma, { key: 'other_key' });
    await insertAlgorithmPreset(prisma, { key: 'target_key' });

    const res = await api(app, authCookie).get('/algorithm-presets?key=target_key').expect(200);

    expect(res.body.totalResults).toBe(2);
    for (const preset of res.body.results) {
      expect(preset.key).toBe('target_key');
    }
  });

  it('should filter by version (200)', async () => {
    await insertAlgorithmPreset(prisma, { version: '2.0.0' });
    await insertAlgorithmPreset(prisma, { version: '1.0.0' });
    await insertAlgorithmPreset(prisma, { version: '2.0.0' });

    const res = await api(app, authCookie).get('/algorithm-presets?version=2.0.0').expect(200);

    expect(res.body.totalResults).toBe(2);
    for (const preset of res.body.results) {
      expect(preset.version).toBe('2.0.0');
    }
  });

  it('should return empty results when filters match nothing (200)', async () => {
    await insertAlgorithmPreset(prisma, { key: 'key_1' });
    await insertAlgorithmPreset(prisma, { key: 'key_2' });

    const res = await api(app, authCookie).get('/algorithm-presets?key=non_existent_key').expect(200);

    assertPaginationStructure(res.body);
    expect(res.body.results).toEqual([]);
    expect(res.body.totalResults).toBe(0);
    expect(res.body.totalPages).toBe(0);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(10);
  });
});
