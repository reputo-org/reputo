import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { CommunityAuthError } from '@reputo/community-api';
import { filter, firstValueFrom, take, timeout } from 'rxjs';
import type { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommunityService } from '../../../src/community/community.service';
import { CommunityEventsService } from '../../../src/community/community-events.service';
import type { CommunityConnectionEventDto } from '../../../src/community/dto';
import { CommunityConnectionListenerService } from '../../../src/persistence';
import { createTestApp } from '../../utils/app-test.module';
import { createAuthenticatedSession } from '../../utils/auth-session';
import { getTestDataSource } from '../../utils/db';
import { getSharedDatabaseUrl } from '../../utils/postgres-testcontainer';
import { api } from '../../utils/request';

const GUILD = { id: '974492421130127923', name: 'SingularityNET' };
const PROBE = {
  resourceCount: 2,
  readableResourceCount: 2,
  resourcesDigest: 'digest-2',
  sampledResourceId: '1',
  sampledRecordCount: 1,
};

const discord = {
  buildInstallUrl: vi.fn((state: string) => `https://discord.com/oauth2/authorize?scope=bot&state=${state}`),
  exchangeCode: vi.fn(async () => GUILD),
  listResources: vi.fn(async () => []),
  probe: vi.fn(async () => PROBE),
  leaveGuild: vi.fn(async () => undefined),
};

const noopLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), setContext: vi.fn() };

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Community connection events via PostgreSQL LISTEN/NOTIFY', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminCookie: string;
  let listener: CommunityConnectionListenerService;
  let events: CommunityEventsService;

  async function connect() {
    const installUrl = await api(app, adminCookie).get('/community/connections/discord/install-url').expect(200);
    const state = new URL(installUrl.body.url).searchParams.get('state') as string;
    await api(app, adminCookie)
      .get(`/community/connections/discord/callback?code=the-code&state=${encodeURIComponent(state)}`)
      .expect(302);

    const list = await api(app, adminCookie).get('/community/connections').expect(200);
    return list.body[0] as { id: string };
  }

  const nextEvent = (predicate: (event: CommunityConnectionEventDto) => boolean) =>
    firstValueFrom(events.subscribe().pipe(filter(predicate), take(1), timeout({ first: 5_000 })));

  beforeAll(async () => {
    const boot = await createTestApp({ discordClient: discord });
    app = boot.app;
    dataSource = getTestDataSource(boot.moduleRef);
    adminCookie = (await createAuthenticatedSession(boot.moduleRef, { role: 'admin' })).cookie;

    // The test app's own listener is a noop; this pair is the real path from
    // the trigger to a subscriber, over the real repositories.
    listener = new CommunityConnectionListenerService({
      get: vi.fn((key: string) => (key === 'database.url' ? getSharedDatabaseUrl() : undefined)),
    } as unknown as ConfigService);
    await listener.onModuleInit();
    events = new CommunityEventsService(noopLogger as never, listener, boot.moduleRef.get(CommunityService), {
      get: vi.fn(() => 30_000),
    } as unknown as ConfigService);
    events.onModuleInit();
  }, 120_000);

  beforeEach(() => {
    vi.clearAllMocks();
    discord.exchangeCode.mockResolvedValue(GUILD);
    discord.probe.mockResolvedValue(PROBE);
  });

  afterEach(async () => {
    await dataSource.query('TRUNCATE TABLE community_connection_audit, community_connections CASCADE');
  });

  afterAll(async () => {
    events.onModuleDestroy();
    await listener.onModuleDestroy();
    await app.close();
  });

  it('announces the watch cadence to every new subscriber', async () => {
    const hello = await firstValueFrom(events.subscribe().pipe(take(1)));

    expect(hello).toEqual({ type: 'community_connection:watch', data: { intervalMs: 30_000 } });
  });

  it('pushes a connect, a state change, and a removal to a subscriber within ~1s', async () => {
    const activated = nextEvent(
      (event) => event.type === 'community_connection:updated' && event.data.status === 'active',
    );
    const connection = await connect();
    expect((await activated).data).toMatchObject({
      id: connection.id,
      status: 'active',
      metadata: { resourceCount: 2, readableResourceCount: 2 },
    });

    const broken = nextEvent(
      (event) => event.type === 'community_connection:updated' && event.data.status === 'broken',
    );
    discord.probe.mockRejectedValue(new CommunityAuthError('401: Unauthorized', 401));
    await api(app, adminCookie).get(`/community/connections/${connection.id}/health`).expect(200);
    expect((await broken).data).toMatchObject({
      id: connection.id,
      status: 'broken',
      statusReason: expect.stringMatching(/rejected Reputo's credentials/),
    });

    const removed = nextEvent((event) => event.type === 'community_connection:removed');
    await api(app, adminCookie).delete(`/community/connections/${connection.id}`).expect(204);
    expect((await removed).data).toEqual({ id: connection.id });
  }, 30_000);

  it('stays quiet when a re-check only refreshes the check timestamp', async () => {
    const connection = await connect();
    await settle(300);

    const received: CommunityConnectionEventDto[] = [];
    const subscription = events.subscribe().subscribe((event) => received.push(event));
    try {
      await api(app, adminCookie).get(`/community/connections/${connection.id}/health`).expect(200);
      await settle(500);
    } finally {
      subscription.unsubscribe();
    }

    expect(received.map((event) => event.type)).toEqual(['community_connection:watch']);
  }, 30_000);
});
