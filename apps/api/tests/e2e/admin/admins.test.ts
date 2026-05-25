import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import supertest from 'supertest';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccessAllowlistEntity, AuthSessionEntity, OAuthUserEntity } from '../../../src/persistence';
import { encryptValue } from '../../../src/shared/utils';
import { createTestApp } from '../../utils/app-test.module';
import { AUTH_TEST_ENV, createAuthenticatedSession } from '../../utils/auth-session';
import { getTestDataSource } from '../../utils/db';
import { startTestDatabase, type TestDatabase } from '../../utils/postgres-testcontainer';
import { api, base } from '../../utils/request';

describe('Admin access management e2e', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.databaseUrl;
    const boot = await createTestApp({});

    app = boot.app;
    moduleRef = boot.moduleRef;
    dataSource = getTestDataSource(moduleRef);
  });

  beforeEach(async () => {
    await dataSource.getRepository(AccessAllowlistEntity).createQueryBuilder().delete().where('1=1').execute();
    await dataSource.getRepository(AuthSessionEntity).createQueryBuilder().delete().where('1=1').execute();
    await dataSource.getRepository(OAuthUserEntity).createQueryBuilder().delete().where('1=1').execute();
  });

  afterAll(async () => {
    await app.close();
    await db?.stop();
  });

  async function createSession(email: string, role: 'admin' | 'owner' = 'admin') {
    return createAuthenticatedSession(moduleRef, { email, role });
  }

  async function createExtraSessionForUser(userId: string): Promise<string> {
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const sessionRepo = dataSource.getRepository(AuthSessionEntity);

    await sessionRepo.save(
      sessionRepo.create({
        sessionId,
        provider: 'deep-id',
        userId,
        accessTokenCiphertext: encryptValue(AUTH_TEST_ENV.AUTH_TOKEN_ENCRYPTION_KEY, 'provider-access-token'),
        refreshTokenCiphertext: encryptValue(AUTH_TEST_ENV.AUTH_TOKEN_ENCRYPTION_KEY, 'provider-refresh-token'),
        accessTokenExpiresAt: expiresAt,
        refreshTokenExpiresAt: expiresAt,
        scope: ['openid', 'profile', 'email', 'offline_access'],
        state: `state-${sessionId}`,
        codeVerifier: `verifier-${sessionId}`,
        expiresAt,
      }),
    );

    return sessionId;
  }

  describe('GET /admins', () => {
    it('returns a paginated list with active rows sorted by email asc by default', async () => {
      await createSession('owner@example.com', 'owner');
      await createSession('z-admin@example.com');
      const admin = await createSession('m-admin@example.com');
      await createSession('a-admin@example.com');

      const response = await api(app, admin.cookie).get('/admins').expect(200);

      expect(response.body.results).toEqual([
        expect.objectContaining({ email: 'a-admin@example.com', role: 'admin', provider: 'deep-id' }),
        expect.objectContaining({ email: 'm-admin@example.com', role: 'admin' }),
        expect.objectContaining({ email: 'owner@example.com', role: 'owner' }),
        expect.objectContaining({ email: 'z-admin@example.com', role: 'admin' }),
      ]);
      expect(response.body.totalResults).toBe(4);
      expect(response.body.page).toBe(1);
      expect(response.body.results[0]).not.toHaveProperty('_id');
      expect(response.body.results[0]).not.toHaveProperty('invitedBy');
    });

    it('filters by status=revoked and surfaces revokedAt/By', async () => {
      const owner = await createSession('owner@example.com', 'owner');
      const allowlistRepo = dataSource.getRepository(AccessAllowlistEntity);
      await allowlistRepo.save(
        allowlistRepo.create({
          provider: 'deep-id',
          email: 'gone@example.com',
          role: 'admin',
          invitedByUserId: null,
          invitedAt: new Date('2026-04-01T00:00:00.000Z'),
          revokedAt: new Date('2026-04-15T00:00:00.000Z'),
          revokedByUserId: owner.userId,
        }),
      );

      const response = await api(app, owner.cookie).get('/admins?status=revoked').expect(200);

      expect(response.body.results).toEqual([
        expect.objectContaining({
          email: 'gone@example.com',
          role: 'admin',
          revokedAt: expect.any(String),
          revokedByEmail: 'owner@example.com',
        }),
      ]);
    });

    it('filters by email prefix search q=', async () => {
      const owner = await createSession('owner@example.com', 'owner');
      await createSession('alpha-one@example.com');
      await createSession('alpha-two@example.com');
      await createSession('beta@example.com');

      const response = await api(app, owner.cookie).get('/admins?q=alpha').expect(200);

      expect(response.body.totalResults).toBe(2);
      expect(response.body.results.map((row: { email: string }) => row.email)).toEqual([
        'alpha-one@example.com',
        'alpha-two@example.com',
      ]);
    });

    it('paginates with page and limit', async () => {
      const owner = await createSession('owner@example.com', 'owner');
      await Promise.all(['a', 'b', 'c', 'd'].map((letter) => createSession(`${letter}@example.com`)));

      const page1 = await api(app, owner.cookie).get('/admins?limit=2&page=1').expect(200);
      const page2 = await api(app, owner.cookie).get('/admins?limit=2&page=2').expect(200);

      expect(page1.body.results).toHaveLength(2);
      expect(page2.body.results).toHaveLength(2);
      expect(page1.body.totalResults).toBe(5);
      expect(page1.body.totalPages).toBe(3);
    });

    it('includes sessions activity when includeSessions=true', async () => {
      const owner = await createSession('owner@example.com', 'owner');
      const admin = await createSession('m-admin@example.com');
      await createExtraSessionForUser(admin.userId);

      const response = await api(app, owner.cookie).get('/admins?includeSessions=true&q=m-admin').expect(200);

      const row = response.body.results[0];
      expect(row.email).toBe('m-admin@example.com');
      expect(row.activeSessionCount).toBeGreaterThanOrEqual(2);
      expect(row.hasEverSignedIn).toBe(true);
      expect(typeof row.lastSignInAt).toBe('string');
    });
  });

  describe('POST /admins', () => {
    it('creates a new admin row', async () => {
      const owner = await createSession('owner@example.com', 'owner');

      const response = await api(app, owner.cookie)
        .post('/admins')
        .send({ provider: 'deep-id', email: ' New.Admin@Example.COM ' })
        .expect(201);

      expect(response.body).toMatchObject({
        provider: 'deep-id',
        email: 'new.admin@example.com',
        role: 'admin',
        invitedByEmail: 'owner@example.com',
      });
    });

    it('creates a new admin row with an explicit owner role', async () => {
      const owner = await createSession('owner@example.com', 'owner');

      const response = await api(app, owner.cookie)
        .post('/admins')
        .send({ provider: 'deep-id', email: 'second-owner@example.com', role: 'owner' })
        .expect(201);

      expect(response.body).toMatchObject({ role: 'owner' });
    });

    it('returns 409 when an active row exists', async () => {
      const owner = await createSession('owner@example.com', 'owner');
      await createSession('active@example.com');

      await api(app, owner.cookie)
        .post('/admins')
        .send({ provider: 'deep-id', email: 'active@example.com' })
        .expect(409);
    });

    it('returns 409 instructing restore when a revoked row exists', async () => {
      const owner = await createSession('owner@example.com', 'owner');
      const allowlistRepo = dataSource.getRepository(AccessAllowlistEntity);
      await allowlistRepo.save(
        allowlistRepo.create({
          provider: 'deep-id',
          email: 'revoked@example.com',
          role: 'admin',
          invitedAt: new Date(),
          revokedAt: new Date(),
        }),
      );

      await api(app, owner.cookie)
        .post('/admins')
        .send({ provider: 'deep-id', email: 'revoked@example.com' })
        .expect(409);
    });

    it('returns 400 when email is malformed', async () => {
      const owner = await createSession('owner@example.com', 'owner');

      await api(app, owner.cookie).post('/admins').send({ provider: 'deep-id', email: 'not-an-email' }).expect(400);
    });

    it('rejects admin callers', async () => {
      const admin = await createSession('admin@example.com');

      await api(app, admin.cookie).post('/admins').send({ provider: 'deep-id', email: 'new@example.com' }).expect(403);
    });
  });

  describe('POST /admins/:provider/:email/restore', () => {
    it('restores a revoked row to admin role', async () => {
      const owner = await createSession('owner@example.com', 'owner');
      const allowlistRepo = dataSource.getRepository(AccessAllowlistEntity);
      await allowlistRepo.save(
        allowlistRepo.create({
          provider: 'deep-id',
          email: 'restore@example.com',
          role: 'admin',
          invitedAt: new Date('2026-01-01T00:00:00.000Z'),
          revokedAt: new Date('2026-02-01T00:00:00.000Z'),
        }),
      );

      const response = await api(app, owner.cookie)
        .post(`/admins/deep-id/${encodeURIComponent('RESTORE@example.com')}/restore`)
        .expect(200);

      expect(response.body).toMatchObject({
        email: 'restore@example.com',
        role: 'admin',
        invitedByEmail: 'owner@example.com',
      });

      const row = await allowlistRepo.findOne({
        where: { provider: 'deep-id', email: 'restore@example.com' },
      });
      expect(row?.revokedAt).toBeNull();
      expect(row?.revokedByUserId).toBeNull();
    });

    it('returns 404 when there is no revoked row', async () => {
      const owner = await createSession('owner@example.com', 'owner');
      await createSession('still-active@example.com');

      await api(app, owner.cookie)
        .post(`/admins/deep-id/${encodeURIComponent('still-active@example.com')}/restore`)
        .expect(404);
    });

    it('rejects admin callers', async () => {
      const admin = await createSession('admin@example.com');

      await api(app, admin.cookie)
        .post(`/admins/deep-id/${encodeURIComponent('whatever@example.com')}/restore`)
        .expect(403);
    });
  });

  describe('PATCH /admins/:provider/:email', () => {
    it('promotes an admin to owner', async () => {
      const owner = await createSession('owner@example.com', 'owner');
      await createSession('promote-me@example.com');

      const response = await api(app, owner.cookie)
        .patch(`/admins/deep-id/${encodeURIComponent('promote-me@example.com')}`)
        .send({ role: 'owner' })
        .expect(200);

      expect(response.body.role).toBe('owner');
    });

    it('demotes an owner to admin when another owner exists', async () => {
      const owner = await createSession('owner-a@example.com', 'owner');
      await createSession('owner-b@example.com', 'owner');

      const response = await api(app, owner.cookie)
        .patch(`/admins/deep-id/${encodeURIComponent('owner-b@example.com')}`)
        .send({ role: 'admin' })
        .expect(200);

      expect(response.body.role).toBe('admin');
    });

    it('forbids the actor from demoting themselves', async () => {
      const owner = await createSession('owner@example.com', 'owner');
      await createSession('owner-b@example.com', 'owner');

      await api(app, owner.cookie)
        .patch(`/admins/deep-id/${encodeURIComponent('owner@example.com')}`)
        .send({ role: 'admin' })
        .expect(403);
    });

    it('forbids demoting the last active owner', async () => {
      const owner = await createSession('owner@example.com', 'owner');

      await api(app, owner.cookie)
        .patch(`/admins/deep-id/${encodeURIComponent('owner@example.com')}`)
        .send({ role: 'admin' })
        .expect(403);
    });

    it('returns 404 when no active row exists', async () => {
      const owner = await createSession('owner@example.com', 'owner');

      await api(app, owner.cookie)
        .patch(`/admins/deep-id/${encodeURIComponent('missing@example.com')}`)
        .send({ role: 'admin' })
        .expect(404);
    });

    it('rejects admin callers', async () => {
      const admin = await createSession('admin@example.com');

      await api(app, admin.cookie)
        .patch(`/admins/deep-id/${encodeURIComponent('admin@example.com')}`)
        .send({ role: 'owner' })
        .expect(403);
    });
  });

  describe('DELETE /admins/:provider/:email', () => {
    it('soft-revokes an admin and revokes all active sessions', async () => {
      const owner = await createSession('owner@example.com', 'owner');
      const admin = await createSession('target@example.com');
      await createExtraSessionForUser(admin.userId);

      await api(app, owner.cookie)
        .delete(`/admins/deep-id/${encodeURIComponent('target@example.com')}`)
        .expect(204);

      const row = await dataSource.getRepository(AccessAllowlistEntity).findOne({
        where: { provider: 'deep-id', email: 'target@example.com' },
      });
      const sessions = await dataSource.getRepository(AuthSessionEntity).find({ where: { userId: admin.userId } });

      expect(row?.revokedAt).toBeTruthy();
      expect(row?.revokedByUserId).toBe(owner.userId);
      expect(sessions).toHaveLength(2);
      expect(sessions.every((session) => session.revokedAt)).toBe(true);

      await supertest(app.getHttpServer()).get(base('/auth/me')).set('Cookie', admin.cookie).expect(401);
    });

    it('forbids the actor from removing themselves', async () => {
      const owner = await createSession('owner@example.com', 'owner');

      await api(app, owner.cookie)
        .delete(`/admins/deep-id/${encodeURIComponent('owner@example.com')}`)
        .expect(403);
    });

    it('forbids removing the last active owner when another owner is the actor', async () => {
      const owner = await createSession('owner-a@example.com', 'owner');
      await createSession('owner-b@example.com', 'owner');

      await api(app, owner.cookie)
        .delete(`/admins/deep-id/${encodeURIComponent('owner-b@example.com')}`)
        .expect(204);

      await api(app, owner.cookie)
        .delete(`/admins/deep-id/${encodeURIComponent('owner-a@example.com')}`)
        .expect(403);
    });

    it('returns 404 when no active row exists', async () => {
      const owner = await createSession('owner@example.com', 'owner');

      await api(app, owner.cookie)
        .delete(`/admins/deep-id/${encodeURIComponent('missing@example.com')}`)
        .expect(404);
    });

    it('rejects admin callers', async () => {
      const owner = await createSession('owner@example.com', 'owner');
      const admin = await createSession('admin@example.com');

      await api(app, admin.cookie)
        .delete(`/admins/deep-id/${encodeURIComponent('owner@example.com')}`)
        .expect(403);

      const row = await dataSource.getRepository(AccessAllowlistEntity).findOne({
        where: { provider: 'deep-id', email: 'owner@example.com' },
      });
      expect(row?.revokedAt).toBeNull();
      expect(owner.cookie).toBeTruthy();
    });
  });
});
