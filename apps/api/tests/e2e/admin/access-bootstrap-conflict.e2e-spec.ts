import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OwnerEmailConflictError } from '../../../src/admin';
import { AuthModule } from '../../../src/auth';
import { configModules } from '../../../src/config';
import { PrismaModule, PrismaService } from '../../../src/persistence';
import { applyAuthTestEnv } from '../../utils/auth-session';
import { startMongo, stopMongo } from '../../utils/mongo-memory-server';
import { startTestDatabase, type TestDatabase } from '../../utils/postgres-testcontainer';

describe('Admin owner bootstrap conflict e2e', () => {
  let mongoUri: string;
  let db: TestDatabase;
  let prisma: PrismaService;

  beforeAll(async () => {
    mongoUri = await startMongo();
    db = await startTestDatabase();
    process.env.DATABASE_URL = db.databaseUrl;
    prisma = new PrismaService();
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.accessAllowlist.deleteMany({});
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await stopMongo();
    await db?.stop();
  });

  it('fails app startup when OWNER_EMAIL is held by an active non-owner allowlist row', async () => {
    applyAuthTestEnv({
      OWNER_EMAIL: 'configured-owner@example.com',
    });
    await prisma.accessAllowlist.create({
      data: {
        provider: 'deep_id',
        email: 'configured-owner@example.com',
        role: 'admin',
        invitedBy: null,
        invitedAt: new Date('2026-04-01T00:00:00.000Z'),
      },
    });

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
          MongooseModule.forRoot(mongoUri),
          PrismaModule,
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
    await prisma.accessAllowlist.create({
      data: {
        provider: 'deep_id',
        email: 'another-owner@example.com',
        role: 'owner',
        invitedBy: null,
        invitedAt: new Date('2026-04-01T00:00:00.000Z'),
      },
    });

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
          MongooseModule.forRoot(mongoUri),
          PrismaModule,
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
