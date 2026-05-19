import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { LoggerModule } from 'nestjs-pino';
import { AlgorithmPresetModule } from '../../src/algorithm-preset/algorithm-preset.module';
import { AuthModule, AuthService } from '../../src/auth';
import { OAuthAuthProviderService } from '../../src/auth/oauth-auth-provider.service';
import { configModules } from '../../src/config';
import { setupSwagger } from '../../src/docs';
import { HttpExceptionFilter } from '../../src/shared/filters/http-exception.filter';
import { SnapshotModule } from '../../src/snapshot/snapshot.module';
import { StorageService } from '../../src/storage/storage.service';
import { TemporalService } from '../../src/temporal';
import { AUTH_TEST_ENV, applyAuthTestEnv } from './auth-session';

export interface TestAppOptions {
  authEnv?: Partial<Record<keyof typeof AUTH_TEST_ENV, string>>;
  includeSwagger?: boolean;
  mongoUri: string;
  oauthProviderService?: Pick<
    OAuthAuthProviderService,
    | 'buildAuthorizationUrl'
    | 'exchangeCodeForTokens'
    | 'fetchUserInfo'
    | 'getDiscoveryDocument'
    | 'getScopes'
    | 'refreshTokens'
  >;
}

export async function createTestApp(options: TestAppOptions) {
  applyAuthTestEnv(options.authEnv);

  const getFilename = (key: string) => key.split('/').pop() ?? key;
  const getExtension = (key: string) => {
    const filename = getFilename(key);
    const dotIndex = filename.lastIndexOf('.');
    return dotIndex >= 0 ? filename.slice(dotIndex + 1).toLowerCase() : '';
  };

  const mockStorageService = {
    getObjectMetadata: async (key: string) => {
      const ext = getExtension(key);

      if (ext === 'json') {
        return {
          filename: getFilename(key),
          ext: 'json',
          size: 64,
          contentType: 'application/json',
          timestamp: Date.now(),
        };
      }

      return {
        filename: getFilename(key),
        ext: 'csv',
        size: 128,
        contentType: 'text/csv',
        timestamp: Date.now(),
      };
    },
    getObject: async (key: string) => {
      if (getExtension(key) === 'json') {
        return Buffer.from(
          JSON.stringify({
            'SubID-1': {
              deepVotingPortalId: 'user-1',
            },
          }),
        );
      }

      return Buffer.from('answer,question_id,collection_id\n10,question-1,user-1\nskip,question-2,user-2\n');
    },
    listObjectsByPrefix: async () => [],
    deleteObjects: async () => ({
      deleted: [],
      errors: [],
    }),
  };

  const mockTemporalService = {
    startSnapshotWorkflow: async () => undefined,
    cancelSnapshotWorkflow: async () => undefined,
    terminateSnapshotWorkflow: async () => undefined,
    cancelSnapshotWorkflows: async () => undefined,
    terminateSnapshotWorkflows: async () => undefined,
  };

  const mockOAuthService =
    options.oauthProviderService ??
    ({
      getScopes: () => ['openid', 'profile', 'email', 'offline_access'],
      buildAuthorizationUrl: async () => 'https://identity.deep-id.ai/oauth2/auth',
      exchangeCodeForTokens: async () => {
        throw new Error('Not implemented in test app');
      },
      refreshTokens: async () => {
        throw new Error('Not implemented in test app');
      },
      fetchUserInfo: async () => {
        throw new Error('Not implemented in test app');
      },
      getDiscoveryDocument: async () => ({
        issuer: process.env.DEEP_ID_ISSUER_URL as string,
        authorization_endpoint: 'https://identity.deep-id.ai/oauth2/auth',
        token_endpoint: 'https://identity.deep-id.ai/oauth2/token',
        userinfo_endpoint: 'https://identity.deep-id.ai/userinfo',
      }),
    } satisfies TestAppOptions['oauthProviderService']);

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
      MongooseModule.forRoot(options.mongoUri),
      AuthModule,
      AlgorithmPresetModule,
      SnapshotModule,
    ],
  })
    .overrideProvider(OAuthAuthProviderService)
    .useValue(mockOAuthService)
    .overrideProvider(StorageService)
    .useValue(mockStorageService)
    .overrideProvider(TemporalService)
    .useValue(mockTemporalService)
    .compile();

  const app = moduleRef.createNestApplication();

  // Apply global pipes matching production
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Enable versioning with /api/v1 prefix
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
    prefix: 'api/v',
  });

  if (options.includeSwagger) {
    setupSwagger(app, moduleRef.get(AuthService));
  }

  await app.init();

  return { app, moduleRef };
}
