import type { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../../src/persistence';
import { insertAlgorithmPreset } from '../../factories/algorithmPreset.factory';
import { createTestApp } from '../../utils/app-test.module';
import { createAuthenticatedSession } from '../../utils/auth-session';
import { startMongo, stopMongo } from '../../utils/mongo-memory-server';
import { startTestDatabase, type TestDatabase } from '../../utils/postgres-testcontainer';
import { api } from '../../utils/request';
import { randomUUIDv7 } from '../../utils/uuid';

describe('PATCH /api/v1/algorithm-presets/:id', () => {
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

  it('should update inputs/name/description (200) and bump updatedAt', async () => {
    const preset = await insertAlgorithmPreset(prisma, {
      name: 'Original Name',
      description: 'Original description text',
    });

    const originalUpdatedAt = new Date(preset.updatedAt).getTime();

    await new Promise((resolve) => setTimeout(resolve, 10));

    const res = await api(app, authCookie)
      .patch(`/algorithm-presets/${preset.id}`)
      .send({
        name: 'Updated Name',
        description: 'Updated description text',
        inputs: [
          { key: 'sub_ids', value: 'uploads/updated-sub_ids.json' },
          { key: 'votes', value: 'uploads/updated-votes.csv' },
        ],
      })
      .expect(200);

    expect(res.body.name).toBe('Updated Name');
    expect(res.body.description).toBe('Updated description text');
    expect(res.body.inputs).toHaveLength(2);
    expect(res.body.inputs[0].key).toBe('sub_ids');
    expect(res.body.inputs[1].key).toBe('votes');

    const newUpdatedAt = new Date(res.body.updatedAt).getTime();
    expect(newUpdatedAt).toBeGreaterThan(originalUpdatedAt);
  });

  it('should return 400 for invalid id format', async () => {
    await api(app, authCookie).patch('/algorithm-presets/invalid-id').send({ name: 'Test' }).expect(400);
  });

  it('should return 404 when preset does not exist', async () => {
    await api(app, authCookie).patch(`/algorithm-presets/${randomUUIDv7()}`).send({ name: 'Test' }).expect(404);
  });

  it('should reject name shorter than 3 chars (400)', async () => {
    const preset = await insertAlgorithmPreset(prisma);

    await api(app, authCookie).patch(`/algorithm-presets/${preset.id}`).send({ name: 'ab' }).expect(400);
  });

  it('should reject name longer than 100 chars (400)', async () => {
    const preset = await insertAlgorithmPreset(prisma);

    await api(app, authCookie)
      .patch(`/algorithm-presets/${preset.id}`)
      .send({ name: 'a'.repeat(101) })
      .expect(400);
  });

  it('should reject description shorter than 10 chars (400)', async () => {
    const preset = await insertAlgorithmPreset(prisma);

    await api(app, authCookie).patch(`/algorithm-presets/${preset.id}`).send({ description: 'short' }).expect(400);
  });

  it('should reject description longer than 500 chars (400)', async () => {
    const preset = await insertAlgorithmPreset(prisma);

    await api(app, authCookie)
      .patch(`/algorithm-presets/${preset.id}`)
      .send({ description: 'a'.repeat(501) })
      .expect(400);
  });

  it('should reject attempts to update key (400)', async () => {
    const preset = await insertAlgorithmPreset(prisma, { key: 'original_key' });

    const res = await api(app, authCookie).patch(`/algorithm-presets/${preset.id}`).send({ key: 'new_key' });

    if (res.status === 200) {
      expect(res.body.key).toBe('original_key');
    } else {
      expect(res.status).toBe(400);
    }
  });

  it('should reject attempts to update version (400)', async () => {
    const preset = await insertAlgorithmPreset(prisma, { version: '1.0.0' });

    const res = await api(app, authCookie).patch(`/algorithm-presets/${preset.id}`).send({ version: '2.0.0' });

    if (res.status === 200) {
      expect(res.body.version).toBe('1.0.0');
    } else {
      expect(res.status).toBe(400);
    }
  });

  it('should reject inputs items without key (400)', async () => {
    const preset = await insertAlgorithmPreset(prisma);

    await api(app, authCookie)
      .patch(`/algorithm-presets/${preset.id}`)
      .send({
        inputs: [{ key: 'valid', value: 'data' }, { value: 'missing-key' }],
      })
      .expect(400);
  });
});
