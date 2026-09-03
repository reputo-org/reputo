import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { CommunityAuthError } from '@reputo/community-api';
import { filter, firstValueFrom, take, timeout } from 'rxjs';
import type { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommunityService } from '../../../src/community/community.service';
import { CommunityEventsService } from '../../../src/community/community-events.service';
import type { CommunityConnectionEventDto } from '../../../src/community/dto';
import { CommunityRealtimeService } from '../../../src/community/realtime';
import { CommunityConnectionListenerService } from '../../../src/persistence';
import { COMMUNITY_WEBHOOKS_ROUTE, GITHUB_WEBHOOK_ROUTE } from '../../../src/shared/constants';
import { createTestApp, type FakeRealtimeSource, FakeRealtimeSources } from '../../utils/app-test.module';
import { createAuthenticatedSession } from '../../utils/auth-session';
import { getTestDataSource } from '../../utils/db';
import { getSharedDatabaseUrl } from '../../utils/postgres-testcontainer';
import { api } from '../../utils/request';

const WEBHOOK_PATH = `/${COMMUNITY_WEBHOOKS_ROUTE}/${GITHUB_WEBHOOK_ROUTE}`;
const WEBHOOK_SECRET = 'github-app-webhook-test-secret';

const GUILD = { id: '974492421130127923', name: 'SingularityNET' };
const INSTALLATION = { id: '5551212', account: 'singnet' };

const twoReadable = {
  resourceCount: 2,
  readableResourceCount: 2,
  resourcesDigest: 'digest-two-readable',
  sampledResourceId: '1',
  sampledRecordCount: 1,
};
/** The same server after an admin hides one channel from the bot. */
const oneReadable = {
  resourceCount: 2,
  readableResourceCount: 1,
  resourcesDigest: 'digest-one-readable',
  sampledResourceId: '1',
  sampledRecordCount: 1,
};

const discord = {
  buildInstallUrl: vi.fn((state: string) => `https://discord.com/oauth2/authorize?scope=bot&state=${state}`),
  exchangeCode: vi.fn(async () => GUILD),
  listResources: vi.fn(async () => []),
  probe: vi.fn(async () => twoReadable),
  leaveGuild: vi.fn(async () => undefined),
};

const github = {
  buildInstallUrl: vi.fn((state: string) => `https://github.com/apps/reputo/installations/new?state=${state}`),
  confirmInstallation: vi.fn(async () => INSTALLATION),
  listResources: vi.fn(async () => []),
  probe: vi.fn(async () => twoReadable),
  deleteInstallation: vi.fn(async () => undefined),
};

const noopLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), setContext: vi.fn() };

/** Signs a delivery the way the GitHub App does. */
function signDelivery(payload: unknown): { body: string; signature: string } {
  const body = JSON.stringify(payload);
  return {
    body,
    signature: `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(Buffer.from(body)).digest('hex')}`,
  };
}

describe('Community connections in real time', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminCookie: string;
  let listener: CommunityConnectionListenerService;
  let events: CommunityEventsService;
  let sources: FakeRealtimeSources;

  const nextEvent = (predicate: (event: CommunityConnectionEventDto) => boolean) =>
    firstValueFrom(events.subscribe().pipe(filter(predicate), take(1), timeout({ first: 10_000 })));

  async function connectDiscord() {
    const installUrl = await api(app, adminCookie).get('/community/connections/discord/install-url').expect(200);
    const state = new URL(installUrl.body.url).searchParams.get('state') as string;
    await api(app, adminCookie)
      .get(`/community/connections/discord/callback?code=the-code&state=${encodeURIComponent(state)}`)
      .expect(302);
    const list = await api(app, adminCookie).get('/community/connections').expect(200);
    return list.body[0] as { id: string; externalId: string };
  }

  async function connectGitHub() {
    const installUrl = await api(app, adminCookie).get('/community/connections/github/install-url').expect(200);
    const state = new URL(installUrl.body.url).searchParams.get('state') as string;
    await api(app, adminCookie)
      .get(
        `/community/connections/github/callback?installation_id=${INSTALLATION.id}&state=${encodeURIComponent(state)}`,
      )
      .expect(302);
    const list = await api(app, adminCookie).get('/community/connections').expect(200);
    return list.body[0] as { id: string; externalId: string };
  }

  beforeAll(async () => {
    sources = new FakeRealtimeSources();
    // The real LISTEN connection, so a connect reaches the supervisor the way
    // it does in production: through the connections channel.
    const boot = await createTestApp({
      discordClient: discord,
      githubClient: github,
      realtimeSources: sources,
      connectionListener: 'real',
    });
    app = boot.app;
    dataSource = getTestDataSource(boot.moduleRef);
    adminCookie = (await createAuthenticatedSession(boot.moduleRef, { role: 'admin' })).cookie;

    // The test app's own listener is a noop; this pair is the real path from
    // the trigger to a subscriber, over the real repositories.
    listener = new CommunityConnectionListenerService({
      get: vi.fn((key: string) => (key === 'database.url' ? getSharedDatabaseUrl() : undefined)),
    } as unknown as ConfigService);
    await listener.onModuleInit();
    events = new CommunityEventsService(
      noopLogger as never,
      listener,
      boot.moduleRef.get(CommunityService),
      boot.moduleRef.get(CommunityRealtimeService),
    );
    events.onModuleInit();
  }, 120_000);

  beforeEach(() => {
    vi.clearAllMocks();
    discord.exchangeCode.mockResolvedValue(GUILD);
    discord.probe.mockResolvedValue(twoReadable);
    github.confirmInstallation.mockResolvedValue(INSTALLATION);
    github.probe.mockResolvedValue(twoReadable);
  });

  afterEach(async () => {
    await dataSource.query('TRUNCATE TABLE community_connection_audit, community_connections CASCADE');
  });

  afterAll(async () => {
    events.onModuleDestroy();
    await listener.onModuleDestroy();
    await app.close();
  });

  it('follows a Discord community as soon as it is connected', async () => {
    await connectDiscord();
    await vi.waitFor(() => expect(sources.discordSource?.started).toBe(true), { timeout: 5_000 });
  }, 30_000);

  it('turns a gateway event into a probe, a stored verdict, and an SSE event', async () => {
    const connection = await connectDiscord();
    await vi.waitFor(() => expect(sources.discordSource).not.toBeNull(), { timeout: 5_000 });

    // An admin hides one channel from the bot: Discord reports the channel
    // change, and the probe behind it is what discovers the new verdict.
    discord.probe.mockResolvedValue(oneReadable);
    const updated = nextEvent(
      (event) => event.type === 'community_connection:updated' && event.data.metadata?.readableResourceCount === 1,
    );
    (sources.discordSource as FakeRealtimeSource).emit({
      platform: 'discord',
      externalId: connection.externalId,
      kind: 'resources',
      event: 'CHANNEL_UPDATE',
    });

    expect((await updated).data).toMatchObject({
      id: connection.id,
      status: 'active',
      metadata: { resourceCount: 2, readableResourceCount: 1 },
    });
    expect(discord.probe).toHaveBeenCalled();
  }, 30_000);

  it('breaks a connection the moment the platform says the bot is gone', async () => {
    const connection = await connectDiscord();
    await vi.waitFor(() => expect(sources.discordSource).not.toBeNull(), { timeout: 5_000 });

    discord.probe.mockRejectedValue(new CommunityAuthError('401: Unauthorized', 401));
    const broken = nextEvent(
      (event) => event.type === 'community_connection:updated' && event.data.status === 'broken',
    );
    (sources.discordSource as FakeRealtimeSource).emit({
      platform: 'discord',
      externalId: connection.externalId,
      kind: 'revoked',
      event: 'GUILD_DELETE',
    });

    expect((await broken).data).toMatchObject({ id: connection.id, status: 'broken' });
  }, 30_000);

  it('ignores a gateway event for a community nobody connected', async () => {
    await connectDiscord();
    await vi.waitFor(() => expect(sources.discordSource).not.toBeNull(), { timeout: 5_000 });
    discord.probe.mockClear();

    (sources.discordSource as FakeRealtimeSource).emit({
      platform: 'discord',
      externalId: 'a-guild-nobody-connected',
      kind: 'resources',
      event: 'CHANNEL_UPDATE',
    });
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(discord.probe).not.toHaveBeenCalled();
  }, 30_000);

  describe('GitHub App deliveries', () => {
    it('re-probes the installation a signed delivery names', async () => {
      const connection = await connectGitHub();

      github.probe.mockResolvedValue(oneReadable);
      const updated = nextEvent(
        (event) => event.type === 'community_connection:updated' && event.data.metadata?.readableResourceCount === 1,
      );
      const { body, signature } = signDelivery({
        action: 'removed',
        installation: { id: Number(INSTALLATION.id) },
      });

      await api(app)
        .post(WEBHOOK_PATH)
        .set('x-github-event', 'installation_repositories')
        .set('x-github-delivery', 'delivery-1')
        .set('x-hub-signature-256', signature)
        .set('content-type', 'application/json')
        .send(body)
        .expect(202);

      expect((await updated).data).toMatchObject({ id: connection.id, metadata: { readableResourceCount: 1 } });
    }, 30_000);

    it('needs no session, but refuses a delivery it cannot authenticate', async () => {
      await connectGitHub();
      const { body } = signDelivery({ action: 'deleted', installation: { id: Number(INSTALLATION.id) } });
      github.probe.mockClear();

      await api(app)
        .post(WEBHOOK_PATH)
        .set('x-github-event', 'installation')
        .set('x-hub-signature-256', 'sha256=not-the-right-digest')
        .set('content-type', 'application/json')
        .send(body)
        .expect(401);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(github.probe).not.toHaveBeenCalled();
    }, 30_000);

    it('accepts a ping without probing anything', async () => {
      await connectGitHub();
      github.probe.mockClear();
      const { body, signature } = signDelivery({ zen: 'Practicality beats purity.', hook_id: 1 });

      await api(app)
        .post(WEBHOOK_PATH)
        .set('x-github-event', 'ping')
        .set('x-hub-signature-256', signature)
        .set('content-type', 'application/json')
        .send(body)
        .expect(202);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(github.probe).not.toHaveBeenCalled();
    }, 30_000);
  });
});
