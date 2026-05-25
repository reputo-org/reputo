import type { INestApplication } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { insertAlgorithmPreset } from '../../factories/algorithmPreset.factory';
import { insertSnapshot } from '../../factories/snapshot.factory';
import { createTestApp } from '../../utils/app-test.module';
import { createAuthenticatedSession } from '../../utils/auth-session';
import { getTestDataSource, truncateBusinessTables } from '../../utils/db';
import { api } from '../../utils/request';
import { randomUUIDv7 } from '../../utils/uuid';

describe('GET /api/v1/snapshots/:id', () => {
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

  it('should get snapshot with frozen preset by id (200)', async () => {
    const preset = await insertAlgorithmPreset(dataSource, { key: 'test_key', version: '2.0.0' });
    const snapshot = await insertSnapshot(dataSource, preset.id, {
      key: preset.key,
      version: preset.version,
      inputs: (preset.inputs as Array<{ key: string; value?: unknown }>) ?? [],
      createdAt: preset.createdAt,
      updatedAt: preset.updatedAt,
    });

    const res = await api(app, authCookie).get(`/snapshots/${snapshot.id}`).expect(200);

    expect(res.body._id).toBe(snapshot.id);
    expect(res.body.algorithmPresetFrozen).toBeInstanceOf(Object);
    expect(res.body.algorithmPresetFrozen.key).toBe('test_key');
    expect(res.body.algorithmPresetFrozen.version).toBe('2.0.0');
    expect(res.body.status).toBe('queued');
    expect(typeof res.body.createdAt).toBe('string');
    expect(typeof res.body.updatedAt).toBe('string');
  });

  it('should return 400 for invalid id format', async () => {
    await api(app, authCookie).get('/snapshots/invalid-id').expect(400);
  });

  it('should return 404 when snapshot does not exist', async () => {
    await api(app, authCookie).get(`/snapshots/${randomUUIDv7()}`).expect(404);
  });
});
