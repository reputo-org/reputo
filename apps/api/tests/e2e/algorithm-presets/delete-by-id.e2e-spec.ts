import type { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../../src/persistence';
import { insertAlgorithmPreset } from '../../factories/algorithmPreset.factory';
import { createTestApp } from '../../utils/app-test.module';
import { createAuthenticatedSession } from '../../utils/auth-session';
import { startTestDatabase, type TestDatabase } from '../../utils/postgres-testcontainer';
import { api } from '../../utils/request';
import { randomUUIDv7 } from '../../utils/uuid';

describe('DELETE /api/v1/algorithm-presets/:id', () => {
  let app: INestApplication;
  let authCookie: string;
  let prisma: PrismaService;
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.databaseUrl;
    const boot = await createTestApp({});
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
    await db?.stop();
  });

  it('should delete preset by id (204) with no body', async () => {
    const preset = await insertAlgorithmPreset(prisma);

    const res = await api(app, authCookie).delete(`/algorithm-presets/${preset.id}`).expect(204);

    expect(res.body).toEqual({});
    expect(res.text).toBe('');

    const count = await prisma.algorithmPreset.count({ where: { id: preset.id } });
    expect(count).toBe(0);
  });

  it('should return 400 for invalid id format', async () => {
    await api(app, authCookie).delete('/algorithm-presets/invalid-id').expect(400);
  });

  it('should return 404 when preset does not exist', async () => {
    await api(app, authCookie).delete(`/algorithm-presets/${randomUUIDv7()}`).expect(404);
  });

  it('should make subsequent GET by id return 404 after deletion', async () => {
    const preset = await insertAlgorithmPreset(prisma);

    await api(app, authCookie).delete(`/algorithm-presets/${preset.id}`).expect(204);

    await api(app, authCookie).get(`/algorithm-presets/${preset.id}`).expect(404);
  });

  it('should cascade delete snapshots referencing the preset', async () => {
    const preset = await insertAlgorithmPreset(prisma, {
      key: 'test_key',
      version: '1.0.0',
      inputs: [],
    });
    await prisma.snapshot.create({
      data: {
        algorithmPresetId: preset.id,
        algorithmPresetFrozen: {
          key: preset.key,
          version: preset.version,
        },
        status: 'queued',
      },
    });

    await api(app, authCookie).delete(`/algorithm-presets/${preset.id}`).expect(204);

    const snapshotCount = await prisma.snapshot.count({ where: { algorithmPresetId: preset.id } });
    expect(snapshotCount).toBe(0);
    const presetCount = await prisma.algorithmPreset.count({ where: { id: preset.id } });
    expect(presetCount).toBe(0);
  });

  it('should cascade delete child algorithm_preset_inputs rows when the preset is deleted', async () => {
    const preset = await insertAlgorithmPreset(prisma, {
      inputs: [
        { key: 'a', value: 1 },
        { key: 'b', value: 'two' },
        { key: 'c', value: { nested: true } },
      ],
    });

    const before = await prisma.algorithmPresetInput.count({ where: { algorithmPresetId: preset.id } });
    expect(before).toBe(3);

    await api(app, authCookie).delete(`/algorithm-presets/${preset.id}`).expect(204);

    const after = await prisma.algorithmPresetInput.count({ where: { algorithmPresetId: preset.id } });
    expect(after).toBe(0);
  });
});
