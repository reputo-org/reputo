import type { INestApplication } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { insertAlgorithmPreset } from '../../factories/algorithmPreset.factory';
import { createTestApp } from '../../utils/app-test.module';
import { createAuthenticatedSession } from '../../utils/auth-session';
import { getTestDataSource, truncateBusinessTables } from '../../utils/db';
import { api } from '../../utils/request';
import { randomUUIDv7 } from '../../utils/uuid';

describe('GET /api/v1/algorithm-presets/:id', () => {
  let app: INestApplication;
  let authCookie: string;
  let dataSource: DataSource;

  beforeAll(async () => {
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
  });

  it('should get preset by id (200)', async () => {
    const preset = await insertAlgorithmPreset(dataSource, {
      name: 'Test Preset',
      description: 'Test description for the preset',
    });

    const res = await api(app, authCookie).get(`/algorithm-presets/${preset.id}`).expect(200);

    expect(res.body._id).toBe(preset.id);
    expect(res.body.key).toBe(preset.key);
    expect(res.body.version).toBe(preset.version);
    expect(res.body.name).toBe('Test Preset');
    expect(res.body.description).toBe('Test description for the preset');
    expect(Array.isArray(res.body.inputs)).toBe(true);
    expect(typeof res.body.createdAt).toBe('string');
    expect(typeof res.body.updatedAt).toBe('string');
  });

  it('should return 400 for invalid id format', async () => {
    await api(app, authCookie).get('/algorithm-presets/invalid-id').expect(400);
  });

  it('should return 404 when preset does not exist', async () => {
    await api(app, authCookie).get(`/algorithm-presets/${randomUUIDv7()}`).expect(404);
  });
});
