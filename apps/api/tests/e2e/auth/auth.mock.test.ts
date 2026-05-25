import type { INestApplication } from '@nestjs/common';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import supertest from 'supertest';
import { type DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AuthModule } from '../../../src/auth';
import { configModules } from '../../../src/config';
import { AuthSessionEntity, ENTITIES, OAuthUserEntity } from '../../../src/persistence';
import { MIGRATIONS } from '../../../src/persistence/migrations';
import { HttpExceptionFilter } from '../../../src/shared/filters/http-exception.filter';
import { AUTH_TEST_ENV, applyAuthTestEnv } from '../../utils/auth-session';
import { getTestDataSource } from '../../utils/db';
import { base } from '../../utils/request';

// TODO: These tests override AUTH_MODE='mock' / OWNER_EMAIL at runtime, which
// requires a fresh env.ts per file. The e2e config uses isolate=false (shared
// module graph) to avoid OOM with all e2e specs in one worker, so the override
// is captured by the worker's frozen env.ts. Run this suite with isolate=true
// + multiple workers (and per-worker testcontainer) or rework to not mutate env.
describe.skip('Deep ID auth e2e (mock mode)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

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
        TypeOrmModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService): TypeOrmModuleOptions => ({
            type: 'postgres',
            url: config.get<string>('database.url'),
            entities: [...ENTITIES],
            migrations: [...MIGRATIONS],
            namingStrategy: new SnakeNamingStrategy(),
            synchronize: false,
            migrationsRun: false,
            autoLoadEntities: false,
            logging: false,
          }),
        }),
        AuthModule,
      ],
    }).compile();

    dataSource = getTestDataSource(moduleRef);
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
    await dataSource.getRepository(AuthSessionEntity).createQueryBuilder().delete().where('1=1').execute();
    await dataSource.getRepository(OAuthUserEntity).createQueryBuilder().delete().where('1=1').execute();
  });

  afterAll(async () => {
    await app.close();
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
    const storedSession = await dataSource.getRepository(AuthSessionEntity).findOne({ where: {} });
    const storedUser = await dataSource
      .getRepository(OAuthUserEntity)
      .findOne({ where: { sub: 'did:deep-id:mock-preview-user' } });

    expect(storedSession).toBeTruthy();
    expect(storedUser).toMatchObject({
      provider: 'deep-id',
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

    const sessionRepo = dataSource.getRepository(AuthSessionEntity);
    const activeSession = await sessionRepo.findOne({ where: {} });

    expect(activeSession).toBeTruthy();

    const logoutResponse = await agent.post(base('/auth/logout')).expect(204);

    expect(logoutResponse.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining(`${AUTH_TEST_ENV.AUTH_COOKIE_NAME}=;`)]),
    );

    const revokedSession = await sessionRepo.findOne({ where: { id: activeSession?.id ?? '' } });
    const currentSession = await agent.get(base('/auth/me')).expect(401);

    expect(revokedSession?.revokedAt).toBeTruthy();
    expect(currentSession.body).toMatchObject({
      statusCode: 401,
      path: base('/auth/me'),
    });
  });
});
