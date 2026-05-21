import type { INestApplication } from '@nestjs/common';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import supertest from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AuthModule } from '../../../src/auth';
import { configModules } from '../../../src/config';
import { PrismaModule, PrismaService } from '../../../src/persistence';
import { HttpExceptionFilter } from '../../../src/shared/filters/http-exception.filter';
import { AUTH_TEST_ENV, applyAuthTestEnv } from '../../utils/auth-session';
import { startTestDatabase, type TestDatabase } from '../../utils/postgres-testcontainer';
import { base } from '../../utils/request';

describe('Deep ID auth e2e (mock mode)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let db: TestDatabase;

  beforeAll(async () => {
    applyAuthTestEnv({
      AUTH_MODE: 'mock',
      OWNER_EMAIL: '',
      DEEP_ID_ISSUER_URL: 'https://mock.invalid',
      DEEP_ID_CLIENT_ID: 'mock-client-id',
      DEEP_ID_CLIENT_SECRET: 'mock-client-secret',
      DEEP_ID_AUTH_REDIRECT_URI: 'https://mock.invalid/callback',
      APP_PUBLIC_URL: 'https://mock.invalid',
    });

    db = await startTestDatabase();
    process.env.DATABASE_URL = db.databaseUrl;

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          load: configModules,
          isGlobal: true,
          ignoreEnvFile: true,
        }),
        LoggerModule.forRoot({
          pinoHttp: {
            level: 'silent',
          },
        }),
        PrismaModule,
        AuthModule,
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    app = moduleRef.createNestApplication();

    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
      prefix: 'api/v',
    });

    await app.init();
  });

  afterEach(async () => {
    await prisma.authSession.deleteMany({});
    await prisma.oAuthUser.deleteMany({});
  });

  afterAll(async () => {
    await app.close();
    await db?.stop();
  });

  it('creates a mock session during login and bootstraps /me', async () => {
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
    expect(loginResponse.headers['set-cookie']).not.toEqual(
      expect.arrayContaining([expect.stringContaining(`${AUTH_TEST_ENV.AUTH_COOKIE_NAME}.flow=`)]),
    );

    const currentSession = await agent.get(base('/auth/me')).expect(200);
    const storedSession = await prisma.authSession.findFirst({});
    const storedUser = await prisma.oAuthUser.findFirst({ where: { sub: 'did:deep-id:mock-preview-user' } });

    expect(storedSession).toBeTruthy();
    expect(storedUser).toMatchObject({
      provider: 'deep_id',
      sub: 'did:deep-id:mock-preview-user',
      email: 'preview@reputo.local',
      emailVerified: true,
      username: 'preview-user',
    });
    expect(currentSession.body).toMatchObject({
      authenticated: true,
      provider: 'deep-id',
      role: 'owner',
      scope: ['openid', 'profile', 'email', 'offline_access'],
      user: {
        provider: 'deep-id',
        role: 'owner',
        sub: 'did:deep-id:mock-preview-user',
        email: 'preview@reputo.local',
        email_verified: true,
        username: 'preview-user',
      },
    });
  });

  it('creates a mock session during callback without calling Deep ID', async () => {
    const agent = supertest.agent(app.getHttpServer());

    const callbackResponse = await agent
      .get(base('/auth/deep-id/callback'))
      .set('x-forwarded-proto', 'https')
      .set('x-forwarded-host', 'preview.reputo.dev')
      .expect(302);

    expect(callbackResponse.headers.location).toBe('https://preview.reputo.dev');
    expect(callbackResponse.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining(`${AUTH_TEST_ENV.AUTH_COOKIE_NAME}=`)]),
    );

    const currentSession = await agent.get(base('/auth/me')).expect(200);

    expect(currentSession.body.user).toMatchObject({
      role: 'owner',
      sub: 'did:deep-id:mock-preview-user',
      username: 'preview-user',
    });
  });

  it('logs out by clearing the cookie and revoking the stored mock session', async () => {
    const agent = supertest.agent(app.getHttpServer());

    await agent
      .get(base('/auth/deep-id/login'))
      .set('x-forwarded-proto', 'https')
      .set('x-forwarded-host', 'preview.reputo.dev')
      .expect(302);

    const activeSession = await prisma.authSession.findFirst({});

    expect(activeSession).toBeTruthy();

    const logoutResponse = await agent.post(base('/auth/logout')).expect(204);

    expect(logoutResponse.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining(`${AUTH_TEST_ENV.AUTH_COOKIE_NAME}=;`)]),
    );

    const revokedSession = await prisma.authSession.findUnique({ where: { id: activeSession?.id ?? '' } });
    const currentSession = await agent.get(base('/auth/me')).expect(401);

    expect(revokedSession?.revokedAt).toBeTruthy();
    expect(currentSession.body).toMatchObject({
      statusCode: 401,
      path: base('/auth/me'),
    });
  });
});
