import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { type AccessAllowlist, AccessAllowlistSchema, MODEL_NAMES, OAuthProviderDeepId } from '@reputo/database';
import mongoose from 'mongoose';
import { LoggerModule } from 'nestjs-pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OwnerEmailConflictError } from '../../../src/admin';
import { AuthModule } from '../../../src/auth';
import { configModules } from '../../../src/config';
import { applyAuthTestEnv } from '../../utils/auth-session';
import { startMongo, stopMongo } from '../../utils/mongo-memory-server';

describe('Admin owner bootstrap conflict e2e', () => {
  let mongoUri: string;

  beforeAll(async () => {
    mongoUri = await startMongo();
  });

  afterAll(async () => {
    await stopMongo();
  });

  it('fails app startup when OWNER_EMAIL is held by an active non-owner allowlist row', async () => {
    applyAuthTestEnv({
      OWNER_EMAIL: 'configured-owner@example.com',
    });
    await seedExistingRow(mongoUri, {
      email: 'configured-owner@example.com',
      role: 'admin',
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
    await seedExistingRow(mongoUri, {
      email: 'another-owner@example.com',
      role: 'owner',
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

async function seedExistingRow(mongoUri: string, options: { email: string; role: 'owner' | 'admin' }): Promise<void> {
  const connection = await mongoose.createConnection(mongoUri).asPromise();

  try {
    const accessAllowlistModel = connection.model<AccessAllowlist>(MODEL_NAMES.ACCESS_ALLOWLIST, AccessAllowlistSchema);

    await accessAllowlistModel.deleteMany({});
    await accessAllowlistModel.create({
      provider: OAuthProviderDeepId,
      email: options.email,
      role: options.role,
      invitedBy: null,
      invitedAt: new Date('2026-04-01T00:00:00.000Z'),
    });
  } finally {
    await connection.close();
  }
}
