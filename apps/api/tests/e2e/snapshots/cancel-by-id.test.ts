import type { INestApplication } from '@nestjs/common';
import { SnapshotStatus } from '@reputo/contracts';
import type { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { insertAlgorithmPreset } from '../../factories/algorithmPreset.factory';
import { insertSnapshot } from '../../factories/snapshot.factory';
import { createTestApp } from '../../utils/app-test.module';
import { createAuthenticatedSession } from '../../utils/auth-session';
import { getTestDataSource, truncateBusinessTables } from '../../utils/db';
import { api } from '../../utils/request';
import { randomUUIDv7 } from '../../utils/uuid';

describe('POST /api/v1/snapshots/:id/cancel', () => {
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

  async function seedSnapshot(status?: SnapshotStatus) {
    const preset = await insertAlgorithmPreset(dataSource, { key: 'test_key', version: '1.0.0', inputs: [] });
    return insertSnapshot(
      dataSource,
      preset.id,
      {
        key: preset.key,
        version: preset.version,
        inputs: (preset.inputs as Array<{ key: string; value?: unknown }>) ?? [],
        createdAt: preset.createdAt,
        updatedAt: preset.updatedAt,
      },
      status === undefined ? undefined : { status },
    );
  }

  it.each([
    [SnapshotStatus.queued],
    [SnapshotStatus.running],
  ])('should accept cancellation of a %s snapshot (202) and return the row', async (status) => {
    const snapshot = await seedSnapshot(status);

    const res = await api(app, authCookie).post(`/snapshots/${snapshot.id}/cancel`).expect(202);

    // Settling is asynchronous, so the row still reads its pre-cancel status.
    expect(res.body._id).toBe(snapshot.id);
    expect(res.body.status).toBe(status);
  });

  it.each([
    [SnapshotStatus.completed],
    [SnapshotStatus.failed],
    [SnapshotStatus.cancelled],
  ])('should reject cancelling a %s snapshot with 409', async (status) => {
    const snapshot = await seedSnapshot(status);

    const res = await api(app, authCookie).post(`/snapshots/${snapshot.id}/cancel`).expect(409);

    expect(JSON.stringify(res.body)).toContain(`is ${status}`);
  });

  it('should return 400 for invalid id format', async () => {
    await api(app, authCookie).post('/snapshots/invalid-id/cancel').expect(400);
  });

  it('should return 404 when snapshot does not exist', async () => {
    await api(app, authCookie).post(`/snapshots/${randomUUIDv7()}/cancel`).expect(404);
  });
});
