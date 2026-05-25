import type { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OwnerEmailConflictError } from '../../../src/admin';
import { AuthModule } from '../../../src/auth';
import { configModules } from '../../../src/config';
import { AccessAllowlistEntity, ENTITIES } from '../../../src/persistence';
import { MIGRATIONS } from '../../../src/persistence/migrations';
import { applyAuthTestEnv } from '../../utils/auth-session';
import { startTestDatabase, type TestDatabase } from '../../utils/postgres-testcontainer';

describe('Admin owner bootstrap conflict e2e', () => {
  let db: TestDatabase;
  let dataSource: DataSource;

  beforeAll(async () => {
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.databaseUrl;
    dataSource = new DataSource({
      type: 'postgres',
      url: db.databaseUrl,
      entities: [...ENTITIES],
      migrations: [...MIGRATIONS],
      namingStrategy: new SnakeNamingStrategy(),
      synchronize: false,
      migrationsRun: false,
      logging: false,
    });
    await dataSource.initialize();
  });

  beforeEach(async () => {
    await dataSource.getRepository(AccessAllowlistEntity).createQueryBuilder().delete().where('1=1').execute();
  });

  afterAll(async () => {
    await dataSource.destroy();
    await db?.stop();
  });

  it('fails app startup when OWNER_EMAIL is held by an active non-owner allowlist row', async () => {
    applyAuthTestEnv({
      OWNER_EMAIL: 'configured-owner@example.com',
    });
    const allowlistRepo = dataSource.getRepository(AccessAllowlistEntity);
    await allowlistRepo.save(
      allowlistRepo.create({
        provider: 'deep-id',
        email: 'configured-owner@example.com',
        role: 'admin',
        invitedByUserId: null,
        invitedAt: new Date('2026-04-01T00:00:00.000Z'),
      }),
    );

    let app: INestApplication | undefined;
    let moduleRef: TestingModule | undefined;

    try {
      moduleRef = await Test.createTestingModule({
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
      app = moduleRef.createNestApplication();

      await expect(app.init()).rejects.toThrow(OwnerEmailConflictError);
    } finally {
      await app?.close().catch(() => undefined);
      await moduleRef?.close().catch(() => undefined);
    }
  });

  it('starts cleanly when OWNER_EMAIL coexists with other active owners', async () => {
    applyAuthTestEnv({
      OWNER_EMAIL: 'configured-owner@example.com',
    });
    const allowlistRepo = dataSource.getRepository(AccessAllowlistEntity);
    await allowlistRepo.save(
      allowlistRepo.create({
        provider: 'deep-id',
        email: 'another-owner@example.com',
        role: 'owner',
        invitedByUserId: null,
        invitedAt: new Date('2026-04-01T00:00:00.000Z'),
      }),
    );

    let app: INestApplication | undefined;
    let moduleRef: TestingModule | undefined;

    try {
      moduleRef = await Test.createTestingModule({
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
      app = moduleRef.createNestApplication();

      await expect(app.init()).resolves.not.toThrow();
    } finally {
      await app?.close().catch(() => undefined);
      await moduleRef?.close().catch(() => undefined);
    }
  });
});
