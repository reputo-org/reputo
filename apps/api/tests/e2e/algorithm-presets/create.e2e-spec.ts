import type { INestApplication } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../../src/persistence';
import { makeAlgorithmPreset } from '../../factories/algorithmPreset.factory';
import { createTestApp } from '../../utils/app-test.module';
import { createAuthenticatedSession } from '../../utils/auth-session';
import { startMongo, stopMongo } from '../../utils/mongo-memory-server';
import { startTestDatabase, type TestDatabase } from '../../utils/postgres-testcontainer';
import { api } from '../../utils/request';

describe('POST /api/v1/algorithm-presets', () => {
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

  it('should create algorithm preset (201) with required fields only', async () => {
    const dto = makeAlgorithmPreset();

    const res = await api(app, authCookie).post('/algorithm-presets').send(dto).expect(201);

    expect(res.body).toHaveProperty('_id');
    expect(res.body._id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.key).toBe(dto.key);
    expect(res.body.version).toBe(dto.version);
    expect(Array.isArray(res.body.inputs)).toBe(true);
    expect(res.body.inputs).toHaveLength(dto.inputs.length);
    expect(typeof res.body.createdAt).toBe('string');
    expect(typeof res.body.updatedAt).toBe('string');
  });

  it('should persist optional name and description when valid (201)', async () => {
    const dto = makeAlgorithmPreset({
      name: 'Valid Algorithm Name',
      description: 'This is a valid description with more than 10 characters',
    });

    const res = await api(app, authCookie).post('/algorithm-presets').send(dto).expect(201);

    expect(res.body.name).toBe(dto.name);
    expect(res.body.description).toBe(dto.description);
  });

  it('should reject when key is missing (400)', async () => {
    const dto = makeAlgorithmPreset();
    delete (dto as { key?: string }).key;

    await api(app, authCookie).post('/algorithm-presets').send(dto).expect(400);
  });

  it('should reject when version is missing (400)', async () => {
    const dto = makeAlgorithmPreset();
    delete (dto as { version?: string }).version;

    await api(app, authCookie).post('/algorithm-presets').send(dto).expect(400);
  });

  it('should reject when inputs is missing (400)', async () => {
    const dto = makeAlgorithmPreset();
    delete (dto as { inputs?: unknown }).inputs;

    await api(app, authCookie).post('/algorithm-presets').send(dto).expect(400);
  });

  it('should reject when any input item has no key (400)', async () => {
    const dto = makeAlgorithmPreset({
      inputs: [{ key: 'valid', value: 'data' }, { value: 'missing-key' }] as Array<{ key: string; value?: unknown }>,
    });

    await api(app, authCookie).post('/algorithm-presets').send(dto).expect(400);
  });

  it('should reject when name is shorter than 3 chars (400)', async () => {
    const dto = makeAlgorithmPreset({ name: 'ab' });

    await api(app, authCookie).post('/algorithm-presets').send(dto).expect(400);
  });

  it('should reject when name is longer than 100 chars (400)', async () => {
    const dto = makeAlgorithmPreset({ name: 'a'.repeat(101) });

    await api(app, authCookie).post('/algorithm-presets').send(dto).expect(400);
  });

  it('should reject when description is shorter than 10 chars (400)', async () => {
    const dto = makeAlgorithmPreset({ description: 'short' });

    await api(app, authCookie).post('/algorithm-presets').send(dto).expect(400);
  });

  it('should reject when description is longer than 500 chars (400)', async () => {
    const dto = makeAlgorithmPreset({ description: 'a'.repeat(501) });

    await api(app, authCookie).post('/algorithm-presets').send(dto).expect(400);
  });

  it('should generate UUID v7 ids that are unique per preset', async () => {
    const a = await api(app, authCookie).post('/algorithm-presets').send(makeAlgorithmPreset()).expect(201);
    const b = await api(app, authCookie).post('/algorithm-presets').send(makeAlgorithmPreset()).expect(201);
    expect(a.body._id).not.toBe(b.body._id);
    expect(a.body._id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
