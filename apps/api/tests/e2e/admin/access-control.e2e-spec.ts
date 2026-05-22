import type { INestApplication } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import supertest from 'supertest';
import type { DataSource } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccessAllowlistEntity, AuthSessionEntity, OAuthUserEntity } from '../../../src/persistence';
import { createTestApp } from '../../utils/app-test.module';
import { AUTH_TEST_ENV } from '../../utils/auth-session';
import { getTestDataSource } from '../../utils/db';
import { startTestDatabase, type TestDatabase } from '../../utils/postgres-testcontainer';
import { base } from '../../utils/request';
import {
  createMockOAuthProviderDouble,
  loginAsMockedProvider,
  requestAs,
  seedAllowlist,
} from '../helpers/access-control';

describe('Admin access-control e2e', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let db: TestDatabase;
  const oauthProvider = createMockOAuthProviderDouble();

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.databaseUrl;
    const boot = await createTestApp({
      oauthProviderService: oauthProvider.service,
    });

    app = boot.app;
    moduleRef = boot.moduleRef;
    dataSource = getTestDataSource(moduleRef);
  });

  beforeEach(async () => {
    oauthProvider.reset();
    await dataSource.getRepository(AccessAllowlistEntity).createQueryBuilder().delete().where('1=1').execute();
    await dataSource.getRepository(AuthSessionEntity).createQueryBuilder().delete().where('1=1').execute();
    await dataSource.getRepository(OAuthUserEntity).createQueryBuilder().delete().where('1=1').execute();
  });

  afterAll(async () => {
    await app.close();
    await db?.stop();
  });

  it('allows an allowlisted verified-email login and returns the resolved role from /me', async () => {
    await seedAllowlist(dataSource.getRepository(AccessAllowlistEntity), 'admin', 'allowed@example.com');

    const login = await loginAsMockedProvider({
      app,
      email: 'allowed@example.com',
      emailVerified: true,
      oauthProvider,
      sub: 'did:deep-id:allowed',
    });
    const cookie = requireSessionCookie(login.cookie);

    expect(login.callbackResponse.headers.location).toBe(AUTH_TEST_ENV.APP_PUBLIC_URL);
    expect(login.callbackResponse.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining(`${AUTH_TEST_ENV.AUTH_COOKIE_NAME}=`)]),
    );

    const currentSession = await requestAs(app, cookie, 'get', '/auth/me').expect(200);

    expect(currentSession.body).toMatchObject({
      authenticated: true,
      provider: 'deep-id',
      role: 'admin',
      user: {
        email: 'allowed@example.com',
        role: 'admin',
        sub: 'did:deep-id:allowed',
      },
    });
  });

  it('redirects a verified email that is not on the allowlist without creating user or session rows', async () => {
    const login = await loginAsMockedProvider({
      app,
      email: 'missing@example.com',
      emailVerified: true,
      oauthProvider,
      sub: 'did:deep-id:missing',
    });

    expect(login.callbackResponse.headers.location).toBe(
      `${AUTH_TEST_ENV.APP_PUBLIC_URL}/access-denied?reason=not_allowlisted`,
    );
    expect(login.cookie).toBeUndefined();
    expect(await dataSource.getRepository(OAuthUserEntity).count()).toBe(0);
    expect(await dataSource.getRepository(AuthSessionEntity).count()).toBe(0);
  });

  it('redirects an unverified callback email before user or session rows are created', async () => {
    await seedAllowlist(dataSource.getRepository(AccessAllowlistEntity), 'admin', 'unverified@example.com');

    const login = await loginAsMockedProvider({
      app,
      email: 'unverified@example.com',
      emailVerified: false,
      oauthProvider,
      sub: 'did:deep-id:unverified',
    });

    expect(login.callbackResponse.headers.location).toBe(
      `${AUTH_TEST_ENV.APP_PUBLIC_URL}/access-denied?reason=email_unverified`,
    );
    expect(login.cookie).toBeUndefined();
    expect(await dataSource.getRepository(OAuthUserEntity).count()).toBe(0);
    expect(await dataSource.getRepository(AuthSessionEntity).count()).toBe(0);
  });

  it('lists owner and active admins for an authenticated admin', async () => {
    const allowlistRepo = dataSource.getRepository(AccessAllowlistEntity);
    await seedAllowlist(allowlistRepo, 'owner', 'owner@example.com');
    await seedAllowlist(allowlistRepo, 'admin', 'admin@example.com');
    await seedAllowlist(allowlistRepo, 'admin', 'z-admin@example.com');
    await seedAllowlist(allowlistRepo, 'admin', 'revoked@example.com', {
      revokedAt: new Date('2026-04-02T00:00:00.000Z'),
    });

    const login = await loginAsMockedProvider({
      app,
      email: 'admin@example.com',
      emailVerified: true,
      oauthProvider,
      sub: 'did:deep-id:admin',
    });

    const response = await requestAs(app, requireSessionCookie(login.cookie), 'get', '/admins').expect(200);

    expect(response.body.results).toEqual([
      expect.objectContaining({ email: 'admin@example.com', role: 'admin' }),
      expect.objectContaining({ email: 'owner@example.com', role: 'owner' }),
      expect.objectContaining({ email: 'z-admin@example.com', role: 'admin' }),
    ]);
    expect(response.body.totalResults).toBe(3);
  });

  it('rejects admin callers from adding admins', async () => {
    await seedAllowlist(dataSource.getRepository(AccessAllowlistEntity), 'admin', 'admin@example.com');

    const login = await loginAsMockedProvider({
      app,
      email: 'admin@example.com',
      emailVerified: true,
      oauthProvider,
      sub: 'did:deep-id:admin-post',
    });

    await requestAs(app, requireSessionCookie(login.cookie), 'post', '/admins', {
      provider: 'deep-id',
      email: 'new-admin@example.com',
    }).expect(403);
  });

  it('creates a new admin as owner and shows the row in GET /admins', async () => {
    await seedAllowlist(dataSource.getRepository(AccessAllowlistEntity), 'owner', 'owner@example.com');

    const owner = await loginAsMockedProvider({
      app,
      email: 'owner@example.com',
      emailVerified: true,
      oauthProvider,
      sub: 'did:deep-id:owner-create',
    });
    const ownerCookie = requireSessionCookie(owner.cookie);

    const created = await requestAs(app, ownerCookie, 'post', '/admins', {
      provider: 'deep-id',
      email: 'New.Admin@Example.COM',
    }).expect(201);

    expect(created.body).toMatchObject({
      provider: 'deep-id',
      email: 'new.admin@example.com',
      role: 'admin',
      invitedByEmail: 'owner@example.com',
    });

    const list = await requestAs(app, ownerCookie, 'get', '/admins').expect(200);

    expect(list.body.results).toEqual(
      expect.arrayContaining([expect.objectContaining({ email: 'new.admin@example.com', role: 'admin' })]),
    );
  });

  it('restores a previously revoked admin as owner via the restore route', async () => {
    const allowlistRepo = dataSource.getRepository(AccessAllowlistEntity);
    await seedAllowlist(allowlistRepo, 'owner', 'owner@example.com');
    await seedAllowlist(allowlistRepo, 'admin', 'restore@example.com', {
      invitedAt: new Date('2026-01-01T00:00:00.000Z'),
      revokedAt: new Date('2026-02-01T00:00:00.000Z'),
    });

    const owner = await loginAsMockedProvider({
      app,
      email: 'owner@example.com',
      emailVerified: true,
      oauthProvider,
      sub: 'did:deep-id:owner-restore',
    });
    const ownerCookie = requireSessionCookie(owner.cookie);

    const restored = await requestAs(
      app,
      ownerCookie,
      'post',
      `/admins/deep-id/${encodeURIComponent('RESTORE@example.com')}/restore`,
    ).expect(200);

    expect(restored.body).toMatchObject({
      email: 'restore@example.com',
      role: 'admin',
      invitedByEmail: 'owner@example.com',
    });

    const row = await allowlistRepo.findOne({
      where: { provider: 'deep-id', email: 'restore@example.com' },
    });
    const list = await requestAs(app, ownerCookie, 'get', '/admins').expect(200);

    expect(row?.revokedAt).toBeNull();
    expect(row?.revokedByUserId).toBeNull();
    expect(list.body.results).toEqual(
      expect.arrayContaining([expect.objectContaining({ email: 'restore@example.com', role: 'admin' })]),
    );
  });

  it('returns 409 when owner adds an already active email', async () => {
    const allowlistRepo = dataSource.getRepository(AccessAllowlistEntity);
    await seedAllowlist(allowlistRepo, 'owner', 'owner@example.com');
    await seedAllowlist(allowlistRepo, 'admin', 'active@example.com');

    const owner = await loginAsMockedProvider({
      app,
      email: 'owner@example.com',
      emailVerified: true,
      oauthProvider,
      sub: 'did:deep-id:owner-active-conflict',
    });

    await requestAs(app, requireSessionCookie(owner.cookie), 'post', '/admins', {
      provider: 'deep-id',
      email: 'active@example.com',
    }).expect(409);
  });

  it('rejects owner self-removal', async () => {
    await seedAllowlist(dataSource.getRepository(AccessAllowlistEntity), 'owner', 'owner@example.com');

    const owner = await loginAsMockedProvider({
      app,
      email: 'owner@example.com',
      emailVerified: true,
      oauthProvider,
      sub: 'did:deep-id:owner-self-remove',
    });

    await requestAs(
      app,
      requireSessionCookie(owner.cookie),
      'delete',
      `/admins/deep-id/${encodeURIComponent('owner@example.com')}`,
    ).expect(403);

    const row = await dataSource.getRepository(AccessAllowlistEntity).findOne({
      where: { provider: 'deep-id', email: 'owner@example.com' },
    });

    expect(row?.revokedAt).toBeNull();
  });

  it('revokes an admin as owner and forces the removed admin cookie to log out on the next request', async () => {
    const allowlistRepo = dataSource.getRepository(AccessAllowlistEntity);
    await seedAllowlist(allowlistRepo, 'owner', 'owner@example.com');
    await seedAllowlist(allowlistRepo, 'admin', 'target@example.com');

    const owner = await loginAsMockedProvider({
      app,
      email: 'owner@example.com',
      emailVerified: true,
      oauthProvider,
      sub: 'did:deep-id:owner-delete',
    });
    const target = await loginAsMockedProvider({
      app,
      email: 'target@example.com',
      emailVerified: true,
      oauthProvider,
      sub: 'did:deep-id:target-delete',
    });
    const targetCookie = requireSessionCookie(target.cookie);

    await requestAs(
      app,
      requireSessionCookie(owner.cookie),
      'delete',
      `/admins/deep-id/${encodeURIComponent('target@example.com')}`,
    ).expect(204);

    const revokedRow = await allowlistRepo.findOne({
      where: { provider: 'deep-id', email: 'target@example.com' },
    });
    const nextRequest = await requestAs(app, targetCookie, 'get', '/auth/me').expect(401);

    expect(revokedRow?.revokedAt).toBeTruthy();
    expect(nextRequest.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining(`${AUTH_TEST_ENV.AUTH_COOKIE_NAME}=;`)]),
    );
  });
});

describe('Admin access-control e2e (mock mode)', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.databaseUrl;
    const boot = await createTestApp({
      authEnv: {
        AUTH_MODE: 'mock',
        OWNER_EMAIL: '',
        DEEP_ID_ISSUER_URL: 'https://mock.invalid',
        DEEP_ID_CLIENT_ID: 'mock-client-id',
        DEEP_ID_CLIENT_SECRET: 'mock-client-secret',
        DEEP_ID_AUTH_REDIRECT_URI: 'https://mock.invalid/callback',
        APP_PUBLIC_URL: 'https://mock.invalid',
      },
    });

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

  it('treats the mock preview user as owner without an allowlist row', async () => {
    const agent = supertest.agent(app.getHttpServer());

    const loginResponse = await agent
      .get(base('/auth/deep-id/login'))
      .set('x-forwarded-proto', 'https')
      .set('x-forwarded-host', 'preview.reputo.dev')
      .expect(302);

    expect(loginResponse.headers.location).toBe('https://preview.reputo.dev');
    expect(loginResponse.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining(`${AUTH_TEST_ENV.AUTH_COOKIE_NAME}=`)]),
    );

    const currentSession = await agent.get(base('/auth/me')).expect(200);

    expect(await dataSource.getRepository(AccessAllowlistEntity).count()).toBe(0);
    expect(currentSession.body).toMatchObject({
      authenticated: true,
      provider: 'deep-id',
      role: 'owner',
      user: {
        email: 'preview@reputo.local',
        role: 'owner',
        sub: 'did:deep-id:mock-preview-user',
      },
    });
  });
});

function requireSessionCookie(cookie: string | undefined): string {
  if (!cookie) {
    throw new Error('Expected login callback to set a session cookie.');
  }

  return cookie;
}
