import type { INestApplication } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SnapshotEntity } from '../../../src/persistence';
import { insertAlgorithmPreset } from '../../factories/algorithmPreset.factory';
import { insertSnapshot } from '../../factories/snapshot.factory';
import { createTestApp } from '../../utils/app-test.module';
import { createAuthenticatedSession } from '../../utils/auth-session';
import { getTestDataSource, truncateBusinessTables } from '../../utils/db';
import { startTestDatabase, type TestDatabase } from '../../utils/postgres-testcontainer';
import { api } from '../../utils/request';
import { randomUUIDv7 } from '../../utils/uuid';

describe('DELETE /api/v1/snapshots/:id', () => {
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

  it('should delete snapshot by id (204) with no body', async () => {
    const preset = await insertAlgorithmPreset(dataSource, { key: 'test_key', version: '1.0.0', inputs: [] });
    const snapshot = await insertSnapshot(dataSource, preset.id, {
      key: preset.key,
      version: preset.version,
      inputs: (preset.inputs as Array<{ key: string; value?: unknown }>) ?? [],
      createdAt: preset.createdAt,
      updatedAt: preset.updatedAt,
    });

    const res = await api(app, authCookie).delete(`/snapshots/${snapshot.id}`).expect(204);

    expect(res.body).toEqual({});
    expect(res.text).toBe('');

    const count = await dataSource.getRepository(SnapshotEntity).count({ where: { id: snapshot.id } });
    expect(count).toBe(0);
  });

  it('should return 400 for invalid id format', async () => {
    await api(app, authCookie).delete('/snapshots/invalid-id').expect(400);
  });

  it('should return 404 when snapshot does not exist', async () => {
    await api(app, authCookie).delete(`/snapshots/${randomUUIDv7()}`).expect(404);
  });

  it('should make subsequent GET by id return 404 after deletion', async () => {
    const preset = await insertAlgorithmPreset(dataSource, { key: 'test_key', version: '1.0.0', inputs: [] });
    const snapshot = await insertSnapshot(dataSource, preset.id, {
      key: preset.key,
      version: preset.version,
      inputs: (preset.inputs as Array<{ key: string; value?: unknown }>) ?? [],
      createdAt: preset.createdAt,
      updatedAt: preset.updatedAt,
    });

    await api(app, authCookie).delete(`/snapshots/${snapshot.id}`).expect(204);

    await api(app, authCookie).get(`/snapshots/${snapshot.id}`).expect(404);
  });
});
