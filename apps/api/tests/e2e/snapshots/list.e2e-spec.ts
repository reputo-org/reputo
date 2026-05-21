import type { INestApplication } from '@nestjs/common';
import type { Snapshot as PrismaSnapshot, SnapshotStatus } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../../src/persistence';
import { insertAlgorithmPreset, randomAlgorithmPreset } from '../../factories/algorithmPreset.factory';
import { insertSnapshot } from '../../factories/snapshot.factory';
import { createTestApp } from '../../utils/app-test.module';
import { createAuthenticatedSession } from '../../utils/auth-session';
import { startMongo, stopMongo } from '../../utils/mongo-memory-server';
import { assertPaginationStructure } from '../../utils/pagination';
import { startTestDatabase, type TestDatabase } from '../../utils/postgres-testcontainer';
import { api } from '../../utils/request';

type FrozenPreset = {
  key: string;
  version: string;
  inputs: Array<{ key: string; value?: unknown }>;
  createdAt: Date;
  updatedAt: Date;
};

function toFrozenPreset(preset: {
  key: string;
  version: string;
  inputs: unknown;
  createdAt: Date;
  updatedAt: Date;
}): FrozenPreset {
  return {
    key: preset.key,
    version: preset.version,
    inputs: preset.inputs as Array<{ key: string; value?: unknown }>,
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt,
  };
}

async function updateStatus(prisma: PrismaService, snapshot: PrismaSnapshot, status: SnapshotStatus): Promise<void> {
  await prisma.snapshot.update({ where: { id: snapshot.id }, data: { status } });
}

describe('GET /api/v1/snapshots', () => {
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

  it('should list snapshots with default pagination (200) and PaginationDto shape', async () => {
    const preset1 = await insertAlgorithmPreset(prisma, randomAlgorithmPreset());
    const preset2 = await insertAlgorithmPreset(prisma, randomAlgorithmPreset());
    const frozen1 = toFrozenPreset(preset1);
    const frozen2 = toFrozenPreset(preset2);

    for (let i = 0; i < 15; i++) {
      const useFirst = i % 2 === 0;
      await insertSnapshot(prisma, useFirst ? preset1.id : preset2.id, useFirst ? frozen1 : frozen2);
    }

    const res = await api(app, authCookie).get('/snapshots').expect(200);

    assertPaginationStructure(res.body);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(10);
    expect(res.body.results).toHaveLength(10);
    expect(res.body.totalResults).toBe(15);
    expect(res.body.totalPages).toBe(2);

    for (const snapshot of res.body.results) {
      expect(snapshot).toHaveProperty('_id');
      expect(snapshot).toHaveProperty('algorithmPresetFrozen');
      expect(snapshot.algorithmPresetFrozen).toHaveProperty('key');
      expect(snapshot.algorithmPresetFrozen).toHaveProperty('version');
      expect(snapshot).toHaveProperty('status');
      expect(snapshot).toHaveProperty('createdAt');
      expect(snapshot).toHaveProperty('updatedAt');
    }
  });

  it('should filter by status=queued (200)', async () => {
    const preset = await insertAlgorithmPreset(prisma);
    const frozen = toFrozenPreset(preset);

    await insertSnapshot(prisma, preset.id, frozen, { status: 'queued' });
    const snapshot2 = await insertSnapshot(prisma, preset.id, frozen);
    await updateStatus(prisma, snapshot2, 'running');

    const res = await api(app, authCookie).get('/snapshots?status=queued').expect(200);

    expect(res.body.totalResults).toBe(1);
    expect(res.body.results[0].status).toBe('queued');
  });

  it('should filter by status=running (200)', async () => {
    const preset = await insertAlgorithmPreset(prisma);
    const frozen = toFrozenPreset(preset);

    await insertSnapshot(prisma, preset.id, frozen);
    const snapshot2 = await insertSnapshot(prisma, preset.id, frozen);
    await updateStatus(prisma, snapshot2, 'running');

    const res = await api(app, authCookie).get('/snapshots?status=running').expect(200);

    expect(res.body.totalResults).toBe(1);
    expect(res.body.results[0].status).toBe('running');
  });

  it('should filter by status=completed (200)', async () => {
    const preset = await insertAlgorithmPreset(prisma);
    const frozen = toFrozenPreset(preset);

    await insertSnapshot(prisma, preset.id, frozen);
    const snapshot2 = await insertSnapshot(prisma, preset.id, frozen);
    await updateStatus(prisma, snapshot2, 'completed');

    const res = await api(app, authCookie).get('/snapshots?status=completed').expect(200);

    expect(res.body.totalResults).toBe(1);
    expect(res.body.results[0].status).toBe('completed');
  });

  it('should filter by status=failed (200)', async () => {
    const preset = await insertAlgorithmPreset(prisma);
    const frozen = toFrozenPreset(preset);

    await insertSnapshot(prisma, preset.id, frozen);
    const snapshot2 = await insertSnapshot(prisma, preset.id, frozen);
    await updateStatus(prisma, snapshot2, 'failed');

    const res = await api(app, authCookie).get('/snapshots?status=failed').expect(200);

    expect(res.body.totalResults).toBe(1);
    expect(res.body.results[0].status).toBe('failed');
  });

  it('should filter by status=cancelled (200)', async () => {
    const preset = await insertAlgorithmPreset(prisma);
    const frozen = toFrozenPreset(preset);

    await insertSnapshot(prisma, preset.id, frozen);
    const snapshot2 = await insertSnapshot(prisma, preset.id, frozen);
    await updateStatus(prisma, snapshot2, 'cancelled');

    const res = await api(app, authCookie).get('/snapshots?status=cancelled').expect(200);

    expect(res.body.totalResults).toBe(1);
    expect(res.body.results[0].status).toBe('cancelled');
  });

  it('should filter by key (200) on frozen preset field', async () => {
    const preset1 = await insertAlgorithmPreset(prisma, { key: 'target_key' });
    const preset2 = await insertAlgorithmPreset(prisma, { key: 'other_key' });

    await insertSnapshot(prisma, preset1.id, toFrozenPreset(preset1));
    await insertSnapshot(prisma, preset2.id, toFrozenPreset(preset2));

    const res = await api(app, authCookie).get('/snapshots?key=target_key').expect(200);

    expect(res.body.totalResults).toBe(1);
    expect(res.body.results[0].algorithmPresetFrozen.key).toBe('target_key');
  });

  it('should filter by version (200) on frozen preset field', async () => {
    const preset1 = await insertAlgorithmPreset(prisma, { version: '2.0.0' });
    const preset2 = await insertAlgorithmPreset(prisma, { version: '1.0.0' });

    await insertSnapshot(prisma, preset1.id, toFrozenPreset(preset1));
    await insertSnapshot(prisma, preset2.id, toFrozenPreset(preset2));

    const res = await api(app, authCookie).get('/snapshots?version=2.0.0').expect(200);

    expect(res.body.totalResults).toBe(1);
    expect(res.body.results[0].algorithmPresetFrozen.version).toBe('2.0.0');
  });

  it('should filter by algorithmPreset (200)', async () => {
    const preset1 = await insertAlgorithmPreset(prisma);
    const preset2 = await insertAlgorithmPreset(prisma);

    await insertSnapshot(prisma, preset1.id, toFrozenPreset(preset1));
    await insertSnapshot(prisma, preset2.id, toFrozenPreset(preset2));

    const res = await api(app, authCookie).get(`/snapshots?algorithmPreset=${preset1.id}`).expect(200);

    expect(res.body.totalResults).toBe(1);
    expect(res.body.results[0].algorithmPreset).toBe(preset1.id);
  });

  it('should filter by algorithmPreset combined with status (200)', async () => {
    const preset1 = await insertAlgorithmPreset(prisma);
    const preset2 = await insertAlgorithmPreset(prisma);

    const snapshot1 = await insertSnapshot(prisma, preset1.id, toFrozenPreset(preset1));
    await updateStatus(prisma, snapshot1, 'completed');
    await insertSnapshot(prisma, preset1.id, toFrozenPreset(preset1));
    await insertSnapshot(prisma, preset2.id, toFrozenPreset(preset2));

    const res = await api(app, authCookie).get(`/snapshots?algorithmPreset=${preset1.id}&status=completed`).expect(200);

    expect(res.body.totalResults).toBe(1);
    expect(res.body.results[0].algorithmPreset).toBe(preset1.id);
    expect(res.body.results[0].status).toBe('completed');
  });

  it('should return 400 for invalid algorithmPreset ID format', async () => {
    await api(app, authCookie).get('/snapshots?algorithmPreset=invalid-id').expect(400);
  });

  it('should sort by createdAt:desc (200)', async () => {
    const preset = await insertAlgorithmPreset(prisma);
    const frozen = toFrozenPreset(preset);

    const snapshot1 = await insertSnapshot(prisma, preset.id, frozen);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const snapshot2 = await insertSnapshot(prisma, preset.id, frozen);

    const res = await api(app, authCookie).get('/snapshots').expect(200);

    expect(res.body.results[0]._id).toBe(snapshot2.id);
    expect(res.body.results[1]._id).toBe(snapshot1.id);
  });

  it('should return empty results when filters match nothing (200)', async () => {
    const preset = await insertAlgorithmPreset(prisma);
    await insertSnapshot(prisma, preset.id, toFrozenPreset(preset));

    const res = await api(app, authCookie).get('/snapshots?status=completed').expect(200);

    assertPaginationStructure(res.body);
    expect(res.body.results).toEqual([]);
    expect(res.body.totalResults).toBe(0);
  });

  it('should return frozen algorithmPreset data (200)', async () => {
    const preset = await insertAlgorithmPreset(prisma, { key: 'test_key', version: '1.0.0' });
    await insertSnapshot(prisma, preset.id, toFrozenPreset(preset));

    const res = await api(app, authCookie).get('/snapshots').expect(200);

    expect(res.body.results[0].algorithmPresetFrozen).toBeInstanceOf(Object);
    expect(res.body.results[0].algorithmPresetFrozen.key).toBe('test_key');
    expect(res.body.results[0].algorithmPresetFrozen.version).toBe('1.0.0');
    expect(typeof res.body.results[0].algorithmPresetFrozen.createdAt).toBe('string');
    expect(typeof res.body.results[0].algorithmPresetFrozen.updatedAt).toBe('string');
  });
});
