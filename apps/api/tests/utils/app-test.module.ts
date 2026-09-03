import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type {
  CommunityRealtimeSource,
  CommunityRealtimeState,
  CommunitySignal,
  CommunitySignalListener,
  DiscordClient,
  GitHubClient,
  MattermostClient,
  MattermostSocketTarget,
} from '@reputo/community-api';
import { LoggerModule } from 'nestjs-pino';
import { AlgorithmPresetModule } from '../../src/algorithm-preset/algorithm-preset.module';
import { AuthModule, AuthService } from '../../src/auth';
import { OAuthAuthProviderService } from '../../src/auth/oauth-auth-provider.service';
import {
  COMMUNITY_REALTIME_SOURCES,
  CommunityModule,
  type CommunityRealtimeSourceFactory,
  DISCORD_CLIENT,
  GITHUB_CLIENT,
  MATTERMOST_CLIENT,
} from '../../src/community';
import { CommunityHealthSweepService } from '../../src/community/community-health-sweep.service';
import { configModules } from '../../src/config';
import { setupSwagger } from '../../src/docs';
import { HealthModule } from '../../src/health';
import { CommunityConnectionListenerService, PersistenceModule, SnapshotListenerService } from '../../src/persistence';
import { HttpExceptionFilter } from '../../src/shared/filters/http-exception.filter';
import { SnapshotModule } from '../../src/snapshot/snapshot.module';
import { SnapshotReconcilerService } from '../../src/snapshot/snapshot-reconciler.service';
import { StorageService } from '../../src/storage/storage.service';
import { TemporalService } from '../../src/temporal';
import { AUTH_TEST_ENV, applyAuthTestEnv } from './auth-session';

export interface TestAppOptions {
  authEnv?: Partial<Record<keyof typeof AUTH_TEST_ENV, string>>;
  discordClient?: DiscordClient;
  githubClient?: GitHubClient;
  /** Pass 'real' to exercise the configured client and its outbound policy. */
  mattermostClient?: MattermostClient | 'real';
  /** Captures every log line, so a suite can grep them for leaked secrets. */
  logStream?: { write: (line: string) => void };
  includeSwagger?: boolean;
  /**
   * Platform feeds under the suite's control. Defaults to feeds that connect
   * but never receive anything, so no test opens a socket to a real platform.
   */
  realtimeSources?: FakeRealtimeSources;
  /**
   * Pass 'real' to keep the PostgreSQL LISTEN connection, so a suite exercises
   * the actual path from a row change to the services that react to it.
   */
  connectionListener?: 'real';
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

/**
 * A feed a test drives by hand. `emit` stands in for the platform pushing an
 * event; `setState` stands in for the socket going down and coming back.
 */
export class FakeRealtimeSource implements CommunityRealtimeSource {
  private readonly signalListeners = new Set<CommunitySignalListener>();
  private readonly stateListeners = new Set<(state: CommunityRealtimeState) => void>();
  private current: CommunityRealtimeState = 'stopped';
  started = false;
  stopped = false;

  constructor(
    readonly platform: CommunitySignal['platform'],
    readonly key: string,
  ) {}

  get state(): CommunityRealtimeState {
    return this.current;
  }

  start(): void {
    this.started = true;
    this.setState('live');
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.setState('stopped');
  }

  onSignal(listener: CommunitySignalListener): () => void {
    this.signalListeners.add(listener);
    return () => this.signalListeners.delete(listener);
  }

  onStateChange(listener: (state: CommunityRealtimeState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  setState(state: CommunityRealtimeState): void {
    this.current = state;
    for (const listener of this.stateListeners) listener(state);
  }

  emit(signal: Omit<CommunitySignal, 'at'>): void {
    for (const listener of this.signalListeners) listener({ ...signal, at: new Date() });
  }
}

/** The feeds one test app handed out, so a suite can push events into them. */
export class FakeRealtimeSources implements CommunityRealtimeSourceFactory {
  discordSource: FakeRealtimeSource | null = null;
  readonly mattermostSources = new Map<string, FakeRealtimeSource>();

  discord(): CommunityRealtimeSource {
    const source = new FakeRealtimeSource('discord', 'bot');
    this.discordSource = source;
    return source;
  }

  mattermost(target: MattermostSocketTarget): CommunityRealtimeSource {
    const key = `${target.serverUrl}/${target.teamId}`;
    const source = new FakeRealtimeSource('mattermost', key);
    this.mattermostSources.set(key, source);
    return source;
  }
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
            'did:sub:aaaaaaaaaaaaaaaaaaaaaaaa': {
              userWallets: [{ address: '0xabc', chain: 'ethereum' }],
            },
          }),
        );
      }

      if (getFilename(key).toLowerCase().includes('wallet_collections')) {
        return Buffer.from('collection_id,address,network\nuser-1,0xabc,ethereum\nuser-2,0xdef,cardano\n');
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
    snapshotWorkflowId: (snapshotId: string) => `snapshot-${snapshotId}`,
    startRunSnapshotWorkflow: async (snapshotId: string) => ({ workflowId: `snapshot-${snapshotId}` }),
    describeSnapshotWorkflow: async () => ({ outcome: 'not_found' as const }),
    getAvailability: () => 'down' as const,
    cancelSnapshotWorkflow: async () => undefined,
    terminateSnapshotWorkflow: async () => undefined,
    cancelSnapshotWorkflows: async () => undefined,
    terminateSnapshotWorkflows: async () => undefined,
  };

  // The reconciler and the health sweep would touch rows the e2e tests seeded
  // with old timestamps; their behavior is covered by their own tests.
  const noopReconciler = {
    onApplicationBootstrap: () => undefined,
    onModuleDestroy: () => undefined,
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

  // Suites that exercise Discord pass their own double; nothing else may reach the network.
  const unreachable = (platform: string) => () => {
    throw new Error(`${platform} client not stubbed in this test app`);
  };

  const unreachableDiscordClient: DiscordClient = {
    buildInstallUrl: unreachable('Discord'),
    exchangeCode: unreachable('Discord'),
    listResources: unreachable('Discord'),
    probe: unreachable('Discord'),
    leaveGuild: unreachable('Discord'),
  };

  const unreachableGitHubClient: GitHubClient = {
    buildInstallUrl: unreachable('GitHub'),
    confirmInstallation: unreachable('GitHub'),
    listResources: unreachable('GitHub'),
    probe: unreachable('GitHub'),
    deleteInstallation: unreachable('GitHub'),
  };

  const unreachableMattermostClient: MattermostClient = {
    validateToken: unreachable('Mattermost'),
    listResources: unreachable('Mattermost'),
    probe: unreachable('Mattermost'),
  };

  const noopListener = {
    notifications$: { subscribe: () => ({ unsubscribe: () => undefined }) },
    onModuleInit: async () => undefined,
    onModuleDestroy: async () => undefined,
  };

  const builder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        load: configModules,
        isGlobal: true,
        ignoreEnvFile: true,
      }),
      LoggerModule.forRoot({
        pinoHttp: options.logStream ? { level: 'debug', stream: options.logStream } : { level: 'silent' },
      }),
      PersistenceModule,
      HealthModule,
      AuthModule,
      AlgorithmPresetModule,
      SnapshotModule,
      CommunityModule,
    ],
  })
    .overrideProvider(DISCORD_CLIENT)
    .useValue(options.discordClient ?? unreachableDiscordClient)
    .overrideProvider(GITHUB_CLIENT)
    .useValue(options.githubClient ?? unreachableGitHubClient)
    .overrideProvider(SnapshotListenerService)
    .useValue(noopListener)
    .overrideProvider(OAuthAuthProviderService)
    .useValue(mockOAuthService)
    .overrideProvider(StorageService)
    .useValue(mockStorageService)
    .overrideProvider(TemporalService)
    .useValue(mockTemporalService)
    .overrideProvider(SnapshotReconcilerService)
    .useValue(noopReconciler)
    .overrideProvider(CommunityHealthSweepService)
    .useValue(noopReconciler)
    .overrideProvider(COMMUNITY_REALTIME_SOURCES)
    .useValue(options.realtimeSources ?? new FakeRealtimeSources());

  if (options.connectionListener !== 'real') {
    builder.overrideProvider(CommunityConnectionListenerService).useValue(noopListener);
  }

  // 'real' keeps the configured client so the outbound policy itself is under test.
  if (options.mattermostClient !== 'real') {
    builder.overrideProvider(MATTERMOST_CLIENT).useValue(options.mattermostClient ?? unreachableMattermostClient);
  }

  const moduleRef = await builder.compile();

  // `rawBody` mirrors the real bootstrap, so the GitHub webhook route can
  // verify a delivery's signature over the exact bytes it received.
  // Options go in the first argument: the testing module reads the second one
  // only when the first is an http server.
  const app = moduleRef.createNestApplication({ rawBody: true });

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

  if (options.includeSwagger) {
    setupSwagger(app, moduleRef.get(AuthService));
  }

  await app.init();

  return { app, moduleRef };
}
