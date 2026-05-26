import type { INestApplication } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { insertAlgorithmPreset } from '../../factories/algorithmPreset.factory';
import { makeSnapshotDto } from '../../factories/snapshot.factory';
import { createTestApp } from '../../utils/app-test.module';
import { createAuthenticatedSession } from '../../utils/auth-session';
import { getTestDataSource, truncateBusinessTables } from '../../utils/db';
import { api } from '../../utils/request';
import { randomUUIDv7 } from '../../utils/uuid';

describe('POST /api/v1/snapshots', () => {
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

  it('should create snapshot (201) with frozen preset and status defaulting to "queued"', async () => {
    const preset = await insertAlgorithmPreset(dataSource);
    const dto = makeSnapshotDto(preset.id);

    const res = await api(app, authCookie).post('/snapshots').send(dto).expect(201);

    expect(res.body).toHaveProperty('_id');
    expect(res.body._id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(res.body.algorithmPresetFrozen).toBeInstanceOf(Object);
    expect(res.body.algorithmPresetFrozen.key).toBe('voting_engagement');
    expect(res.body.algorithmPresetFrozen.version).toBe('1.0.0');
    expect(typeof res.body.algorithmPresetFrozen.createdAt).toBe('string');
    expect(typeof res.body.algorithmPresetFrozen.updatedAt).toBe('string');
    expect(res.body.status).toBe('queued');
    expect(typeof res.body.createdAt).toBe('string');
    expect(typeof res.body.updatedAt).toBe('string');
  });

  it('should reject when algorithmPresetId is missing (400)', async () => {
    await api(app, authCookie).post('/snapshots').send({ outputs: {} }).expect(400);
  });

  it('should reject when algorithmPresetId format is invalid (400)', async () => {
    const dto = makeSnapshotDto('invalid-id');

    await api(app, authCookie).post('/snapshots').send(dto).expect(400);
  });

  it('should reject when algorithmPresetId does not exist (404)', async () => {
    const dto = makeSnapshotDto(randomUUIDv7());

    await api(app, authCookie).post('/snapshots').send(dto).expect(404);
  });
});
