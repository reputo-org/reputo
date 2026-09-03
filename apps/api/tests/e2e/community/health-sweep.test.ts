import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { CommunityAuthError } from '@reputo/community-api';
import { BehaviorSubject } from 'rxjs';
import type { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommunityService } from '../../../src/community/community.service';
import { CommunityConnectionRepository } from '../../../src/community/community-connection.repository';
import { CommunityEventsService } from '../../../src/community/community-events.service';
import { CommunityHealthSweepService } from '../../../src/community/community-health-sweep.service';
import type { CommunityRealtimeService } from '../../../src/community/realtime';
import { CommunityConnectionAuditEntity, CommunityConnectionEntity } from '../../../src/persistence';
import { createTestApp } from '../../utils/app-test.module';
import { createAuthenticatedSession } from '../../utils/auth-session';
import { getTestDataSource } from '../../utils/db';
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

const feedStatus = (overrides: Partial<Record<string, string>> = {}) => ({
  feeds: { discord: 'live', github: 'live', mattermost: 'live', ...overrides },
  fallbackIntervalMs: 60_000,
});

describe('Community health sweep e2e', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminCookie: string;
  let sweep: CommunityHealthSweepService;
  let events: CommunityEventsService;
  let feeds: BehaviorSubject<ReturnType<typeof feedStatus>>;
  let makeSweep: (thresholds: Record<string, number>) => CommunityHealthSweepService;

  async function connect() {
    const installUrl = await api(app, adminCookie).get('/community/connections/discord/install-url').expect(200);
    const state = new URL(installUrl.body.url).searchParams.get('state') as string;
    await api(app, adminCookie)
      .get(`/community/connections/discord/callback?code=the-code&state=${encodeURIComponent(state)}`)
      .expect(302);

    const list = await api(app, adminCookie).get('/community/connections').expect(200);
    return list.body[0];
  }

  beforeAll(async () => {
    const boot = await createTestApp({ discordClient: discord });
    app = boot.app;
    dataSource = getTestDataSource(boot.moduleRef);
    adminCookie = (await createAuthenticatedSession(boot.moduleRef, { role: 'admin' })).cookie;

    // The module's own sweep instance is a noop in tests; this one is the
    // real service over the real repositories. Thresholds are negative so a
    // connection is always due, even when the container Postgres clock runs
    // slightly ahead of this process.
    events = boot.moduleRef.get(CommunityEventsService);
    // Feed status is driven by hand here, so a fallback-polling assertion does
    // not depend on when a feed happened to connect.
    feeds = new BehaviorSubject(feedStatus());
    makeSweep = (thresholds) =>
      new CommunityHealthSweepService(
        noopLogger as never,
        boot.moduleRef.get(CommunityConnectionRepository),
        boot.moduleRef.get(CommunityService),
        events,
        { status$: feeds.asObservable() } as unknown as CommunityRealtimeService,
        {
          get: vi.fn(
            (key: string) =>
              ({
                'community.healthSweep.intervalMs': 60_000,
                'community.healthSweep.probeSpacingMs': 0,
                'community.healthSweep.watchIntervalMs': 60_000,
                ...thresholds,
              })[key],
          ),
        } as unknown as ConfigService,
      );
    sweep = makeSweep({
      'community.healthSweep.activeRecheckAfterMs': -3_600_000,
      'community.healthSweep.failedRecheckAfterMs': -3_600_000,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    discord.exchangeCode.mockResolvedValue(GUILD);
    discord.probe.mockResolvedValue(PROBE);
  });

  afterEach(async () => {
    await dataSource.query('TRUNCATE TABLE community_connection_audit, community_connections CASCADE');
  });

  afterAll(async () => {
    await app.close();
  });

  it('flips a kicked bot to broken without anyone pressing Re-check', async () => {
    const connection = await connect();
    discord.probe.mockRejectedValue(new CommunityAuthError('401: Unauthorized', 401));

    await sweep.sweep();

    const list = await api(app, adminCookie).get('/community/connections').expect(200);
    expect(list.body[0]).toMatchObject({ id: connection.id, status: 'broken' });
    expect(list.body[0].statusReason).toMatch(/rejected Reputo's credentials/);
  });

  it('audits a sweep probe as a system health check with no actor', async () => {
    await connect();
    discord.probe.mockRejectedValue(new CommunityAuthError('401: Unauthorized', 401));

    await sweep.sweep();

    const audits = await dataSource
      .getRepository(CommunityConnectionAuditEntity)
      .find({ where: { action: 'health_check' } });
    expect(audits).toHaveLength(1);
    expect(audits[0].actorUserId).toBeNull();
    expect(audits[0].outcome).toBe('failure');
  });

  it('recovers a fixed connection to active and refreshes its metadata', async () => {
    const connection = await connect();
    discord.probe.mockRejectedValue(new CommunityAuthError('401: Unauthorized', 401));
    await sweep.sweep();

    discord.probe.mockResolvedValue({ ...PROBE, resourceCount: 3, profile: { memberCount: 42 } });
    await sweep.sweep();

    const list = await api(app, adminCookie).get('/community/connections').expect(200);
    expect(list.body[0]).toMatchObject({ id: connection.id, status: 'active' });
    expect(list.body[0].statusReason).toBeUndefined();
    expect(list.body[0].metadata).toEqual({ memberCount: 42, resourceCount: 3, readableResourceCount: 2 });
  });

  it('records only transitions for system checks, so a repeated check leaves no heartbeat log', async () => {
    await connect();
    discord.probe.mockRejectedValue(new CommunityAuthError('401: Unauthorized', 401));

    await sweep.sweep();
    await sweep.sweep();
    await sweep.sweep();

    const audits = await dataSource
      .getRepository(CommunityConnectionAuditEntity)
      .find({ where: { action: 'health_check' } });
    expect(audits).toHaveLength(1);
  });

  it('polls a platform whose live feed is down while a client follows the events stream', async () => {
    const connection = await connect();
    // Checked ten minutes ago: fresh for the reconciliation thresholds, stale for a 60 s fallback.
    await dataSource.query(
      `UPDATE community_connections SET settings = jsonb_set(settings, '{lastCheck,at}', to_jsonb($1::text)) WHERE id = $2`,
      [new Date(Date.now() - 10 * 60_000).toISOString(), connection.id],
    );
    discord.probe.mockClear();
    const periodic = makeSweep({
      'community.healthSweep.activeRecheckAfterMs': 6 * 3_600_000,
      'community.healthSweep.failedRecheckAfterMs': 1_800_000,
    });

    periodic.onApplicationBootstrap();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(discord.probe).not.toHaveBeenCalled();

    const subscription = events.subscribe().subscribe();
    try {
      // A watching client alone changes nothing: the gateway is carrying the
      // changes, so polling would be pure waste.
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(discord.probe).not.toHaveBeenCalled();

      feeds.next(feedStatus({ discord: 'down' }));
      await vi.waitFor(() => expect(discord.probe).toHaveBeenCalledTimes(1));
      expect([...periodic.polledPlatforms]).toEqual(['discord']);
    } finally {
      subscription.unsubscribe();
      periodic.onModuleDestroy();
    }
    expect(periodic.polledPlatforms.size).toBe(0);
  });

  it('never probes a disconnected connection', async () => {
    const connection = await connect();
    await dataSource.getRepository(CommunityConnectionEntity).update({ id: connection.id }, { status: 'disconnected' });
    discord.probe.mockClear();

    await sweep.sweep();

    expect(discord.probe).not.toHaveBeenCalled();
  });
});
