import type { INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { CommunityAuthError } from '@reputo/community-api';
import type { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommunityService } from '../../../src/community/community.service';
import { CommunityAuditRepository } from '../../../src/community/community-audit.repository';
import { CommunityConnectionRepository } from '../../../src/community/community-connection.repository';
import { CommunityHealthSweepService } from '../../../src/community/community-health-sweep.service';
import { CommunityConnectionAuditEntity, CommunityConnectionEntity } from '../../../src/persistence';
import { createTestApp } from '../../utils/app-test.module';
import { createAuthenticatedSession } from '../../utils/auth-session';
import { getTestDataSource } from '../../utils/db';
import { api } from '../../utils/request';

const GUILD = { id: '974492421130127923', name: 'SingularityNET' };
const PROBE = { resourceCount: 2, sampledResourceId: '1', sampledRecordCount: 1 };

const discord = {
  buildInstallUrl: vi.fn((state: string) => `https://discord.com/oauth2/authorize?scope=bot&state=${state}`),
  exchangeCode: vi.fn(async () => GUILD),
  listResources: vi.fn(async () => []),
  probe: vi.fn(async () => PROBE),
  leaveGuild: vi.fn(async () => undefined),
};

const noopLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), setContext: vi.fn() };

describe('Community health sweep e2e', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminCookie: string;
  let sweep: CommunityHealthSweepService;

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
    const alwaysDue = {
      get: vi.fn(
        (key: string) =>
          ({
            'community.healthSweep.intervalMs': 60_000,
            'community.healthSweep.activeRecheckAfterMs': -3_600_000,
            'community.healthSweep.failedRecheckAfterMs': -3_600_000,
            'community.healthSweep.probeSpacingMs': 0,
          })[key],
      ),
    } as unknown as ConfigService;
    sweep = new CommunityHealthSweepService(
      noopLogger as never,
      boot.moduleRef.get(CommunityConnectionRepository),
      boot.moduleRef.get(CommunityAuditRepository),
      boot.moduleRef.get(CommunityService),
      alwaysDue,
    );
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
    expect(list.body[0].metadata).toEqual({ memberCount: 42, resourceCount: 3 });
  });

  it('never probes a disconnected connection', async () => {
    const connection = await connect();
    await dataSource.getRepository(CommunityConnectionEntity).update({ id: connection.id }, { status: 'disconnected' });
    discord.probe.mockClear();

    await sweep.sweep();

    expect(discord.probe).not.toHaveBeenCalled();
  });
});
