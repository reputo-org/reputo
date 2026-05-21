import type { INestApplication } from '@nestjs/common';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../utils/app-test.module';
import { createAuthenticatedSession } from '../../utils/auth-session';
import { startMongo, stopMongo } from '../../utils/mongo-memory-server';
import { startTestDatabase, type TestDatabase } from '../../utils/postgres-testcontainer';
import { base } from '../../utils/request';

describe('Protected API and docs surface', () => {
  let app: INestApplication;
  let authCookie: string;
  let db: TestDatabase;

  beforeAll(async () => {
    const mongoUri = await startMongo();
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.databaseUrl;
    const boot = await createTestApp({
      includeSwagger: true,
      mongoUri,
    });

    app = boot.app;
    authCookie = (await createAuthenticatedSession(boot.moduleRef)).cookie;
  });

  afterAll(async () => {
    await app.close();
    await stopMongo();
    await db?.stop();
  });

  it('rejects the protected inventory without a valid session', async () => {
    const request = supertest(app.getHttpServer());
    const protectedRequests = [
      { body: {}, method: 'post', path: base('/algorithm-presets') },
      { method: 'get', path: base('/algorithm-presets') },
      { method: 'get', path: base('/algorithm-presets/507f1f77bcf86cd799439011') },
      { body: {}, method: 'patch', path: base('/algorithm-presets/507f1f77bcf86cd799439011') },
      { method: 'delete', path: base('/algorithm-presets/507f1f77bcf86cd799439011') },
      { body: {}, method: 'post', path: base('/snapshots') },
      { method: 'get', path: base('/snapshots') },
      { method: 'get', path: base('/snapshots/507f1f77bcf86cd799439011') },
      { method: 'delete', path: base('/snapshots/507f1f77bcf86cd799439011') },
      { method: 'get', path: base('/snapshots/events') },
      { body: {}, method: 'post', path: base('/storage/uploads') },
      { body: {}, method: 'post', path: base('/storage/uploads/verify') },
      { body: {}, method: 'post', path: base('/storage/downloads') },
      { method: 'get', path: base('/storage/stream?key=exports/test.csv') },
      { method: 'get', path: '/docs' },
      { method: 'get', path: '/reference' },
    ] as const;

    for (const pendingRequest of protectedRequests) {
      const response = await request[pendingRequest.method](pendingRequest.path)
        .send('body' in pendingRequest ? pendingRequest.body : undefined)
        .expect(401);

      expect(response.body).toMatchObject({
        statusCode: 401,
      });
    }
  });

  it('allows the docs surface and storage stream when the session cookie is present', async () => {
    const request = supertest(app.getHttpServer());

    await request.get('/docs').set('Cookie', authCookie).expect(200);
    await request.get('/reference').set('Cookie', authCookie).expect(200);

    const streamResponse = await request
      .get(base('/storage/stream?key=exports/test.csv'))
      .set('Cookie', authCookie)
      .expect(200);

    expect(streamResponse.headers['content-disposition']).toContain('attachment;');
    expect(streamResponse.headers['content-type']).toContain('text/csv');
  });
});
