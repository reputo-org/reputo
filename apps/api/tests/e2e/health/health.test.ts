import type { INestApplication } from '@nestjs/common';
import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../../utils/app-test.module';
import { base } from '../../utils/request';

describe('Health endpoint', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const boot = await createTestApp({});
    app = boot.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('responds 200 without a session and reports the build sha', async () => {
    const response = await supertest(app.getHttpServer()).get(base('/health')).expect(200);

    expect(response.body).toMatchObject({ status: 'ok' });
    expect(typeof response.body.sha).toBe('string');
    expect(response.body.sha.length).toBeGreaterThan(0);
  });

  it('reports the temporal and worker component states without failing liveness', async () => {
    const response = await supertest(app.getHttpServer()).get(base('/health')).expect(200);

    // Components are informational; `status` must stay "ok" so Traefik keeps
    // routing to the container during a Temporal outage.
    expect(response.body.status).toBe('ok');
    expect(['up', 'down']).toContain(response.body.temporal);
    expect(['up', 'down', 'disabled']).toContain(response.body.worker);
  });
});
