import type { INestApplication } from '@nestjs/common';
import { CommunityAuthError, CommunityPermissionError, CommunityRateLimitError } from '@reputo/community-api';
import type { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommunityConnectionAuditEntity, CommunityConnectionEntity } from '../../../src/persistence';
import { createTestApp } from '../../utils/app-test.module';
import { createAuthenticatedSession } from '../../utils/auth-session';
import { getTestDataSource } from '../../utils/db';
import { api } from '../../utils/request';

const GUILD = { id: '974492421130127923', name: 'SingularityNET' };
const CHANNELS = [
  { id: '1', name: 'general', kind: 'text' as const },
  { id: '2', name: 'proposals', kind: 'forum' as const },
];
const PROBE = { resourceCount: 2, sampledResourceId: '1', sampledRecordCount: 1, requiredFieldsPresent: true };

const discord = {
  buildInstallUrl: vi.fn(
    (state: string, guildId?: string) =>
      `https://discord.com/oauth2/authorize?scope=bot&state=${state}${guildId ? `&guild_id=${guildId}&disable_guild_select=true` : ''}`,
  ),
  exchangeCode: vi.fn(async () => GUILD),
  listResources: vi.fn(async () => CHANNELS),
  probe: vi.fn(async () => PROBE),
  leaveGuild: vi.fn(async () => undefined),
};

describe('Community connections e2e', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminCookie: string;
  let ownerCookie: string;

  /** Runs the full connect flow and returns the created connection. */
  async function connect(cookie = adminCookie) {
    const installUrl = await api(app, cookie).get('/community/connections/discord/install-url').expect(200);
    const state = new URL(installUrl.body.url).searchParams.get('state') as string;

    const callback = await api(app, cookie)
      .get(`/community/connections/discord/callback?code=the-code&state=${encodeURIComponent(state)}`)
      .expect(302);

    const list = await api(app, cookie).get('/community/connections').expect(200);

    return { callback, connection: list.body[0], connections: list.body };
  }

  beforeAll(async () => {
    const boot = await createTestApp({ discordClient: discord });
    app = boot.app;
    dataSource = getTestDataSource(boot.moduleRef);
    adminCookie = (await createAuthenticatedSession(boot.moduleRef, { role: 'admin' })).cookie;
    ownerCookie = (await createAuthenticatedSession(boot.moduleRef, { role: 'owner' })).cookie;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    discord.exchangeCode.mockResolvedValue(GUILD);
    discord.listResources.mockResolvedValue(CHANNELS);
    discord.probe.mockResolvedValue(PROBE);
    discord.leaveGuild.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await dataSource.query('TRUNCATE TABLE community_connection_audit, community_connections CASCADE');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('connect', () => {
    it('probes the guild and lands an active connection', async () => {
      const { callback, connection } = await connect();

      expect(callback.headers.location).toBe('http://localhost:5173/community?connected=discord');
      expect(connection).toMatchObject({
        platform: 'discord',
        externalId: GUILD.id,
        name: GUILD.name,
        status: 'active',
      });
      expect(connection.statusReason).toBeUndefined();
      expect(discord.probe).toHaveBeenCalledWith(GUILD.id);
    });

    it('reads the guild from the code exchange, not from the redirect query', async () => {
      const installUrl = await api(app, adminCookie).get('/community/connections/discord/install-url').expect(200);
      const state = new URL(installUrl.body.url).searchParams.get('state') as string;

      await api(app, adminCookie)
        .get(
          `/community/connections/discord/callback?code=the-code&guild_id=999&permissions=8&state=${encodeURIComponent(state)}`,
        )
        .expect(302);

      const list = await api(app, adminCookie).get('/community/connections').expect(200);
      expect(list.body[0].externalId).toBe(GUILD.id);
    });

    it('updates the same guild instead of creating a second connection', async () => {
      await connect();
      discord.exchangeCode.mockResolvedValue({ ...GUILD, name: 'SingularityNET renamed' });

      const { connections } = await connect();

      expect(connections).toHaveLength(1);
      expect(connections[0].name).toBe('SingularityNET renamed');
      expect(await dataSource.getRepository(CommunityConnectionEntity).count()).toBe(1);
    });

    it('connects the same guild cleanly after it was disconnected', async () => {
      const first = await connect();
      await api(app, adminCookie).delete(`/community/connections/${first.connection.id}`).expect(204);

      const { connections } = await connect();

      expect(connections).toHaveLength(1);
      expect(connections[0].status).toBe('active');
    });

    it('reports when the platform last confirmed the connection', async () => {
      const { connection } = await connect();

      expect(Date.parse(connection.lastCheckedAt)).not.toBeNaN();
      expect(Date.parse(connection.lastCheckedAt)).toBeLessThanOrEqual(Date.now());
    });

    it('redirects with an invalid_state error when the state is missing, forged, or replayed', async () => {
      for (const query of ['code=the-code', 'code=the-code&state=forged', 'state=forged']) {
        const response = await api(app, adminCookie)
          .get(`/community/connections/discord/callback?${query}`)
          .expect(302);

        expect(response.headers.location).toBe('http://localhost:5173/community?error=invalid_state');
      }
      expect(discord.exchangeCode).not.toHaveBeenCalled();
    });

    it('redirects with a declined error when the admin cancels', async () => {
      const response = await api(app, adminCookie)
        .get('/community/connections/discord/callback?error=access_denied&error_description=The+user+cancelled')
        .expect(302);

      expect(response.headers.location).toBe('http://localhost:5173/community?error=declined');
      expect(discord.exchangeCode).not.toHaveBeenCalled();
    });

    it('breaks the connection when the probe finds no readable channel', async () => {
      discord.probe.mockRejectedValue(new CommunityPermissionError('Missing Access', 403));

      const { callback, connection } = await connect();

      expect(callback.headers.location).toBe('http://localhost:5173/community?error=permission_denied');
      expect(connection.status).toBe('broken');
      expect(connection.statusReason).toMatch(/View Channels or Read Message History/);
    });
  });

  describe('resources', () => {
    it('lists the channels of an active connection', async () => {
      const { connection } = await connect();

      const response = await api(app, adminCookie).get(`/community/connections/${connection.id}/resources`).expect(200);

      expect(response.body).toEqual(CHANNELS);
      expect(discord.listResources).toHaveBeenCalledWith(GUILD.id);
    });

    it('breaks the connection and reports a bad gateway when the bot was revoked', async () => {
      const { connection } = await connect();
      discord.listResources.mockRejectedValue(new CommunityAuthError('401: Unauthorized', 401));

      await api(app, adminCookie).get(`/community/connections/${connection.id}/resources`).expect(502);

      const list = await api(app, adminCookie).get('/community/connections').expect(200);
      expect(list.body[0].status).toBe('broken');
    });

    it('stops listing resources once the connection is gone', async () => {
      const { connection } = await connect();
      await api(app, adminCookie).delete(`/community/connections/${connection.id}`).expect(204);

      await api(app, adminCookie).get(`/community/connections/${connection.id}/resources`).expect(404);
      expect(discord.listResources).not.toHaveBeenCalled();
    });

    it('rejects a malformed id and reports an unknown connection', async () => {
      await api(app, adminCookie).get('/community/connections/not-a-uuid/resources').expect(400);
      await api(app, adminCookie)
        .get('/community/connections/01940000-0000-7000-8000-000000000000/resources')
        .expect(404);
    });
  });

  describe('health', () => {
    it('re-checks an active connection and keeps it active', async () => {
      const { connection } = await connect();

      const response = await api(app, adminCookie).get(`/community/connections/${connection.id}/health`).expect(200);

      expect(response.body).toMatchObject({ status: 'active' });
      expect(response.body.reason).toBeUndefined();
      expect(response.body.checkedAt).toEqual(expect.any(String));
    });

    it('flips a revoked bot to broken with a readable reason', async () => {
      const { connection } = await connect();
      discord.probe.mockRejectedValue(new CommunityAuthError('401: Unauthorized', 401));

      const response = await api(app, adminCookie).get(`/community/connections/${connection.id}/health`).expect(200);

      expect(response.body.status).toBe('broken');
      expect(response.body.reason).toMatch(/rejected the bot credentials/);

      const list = await api(app, adminCookie).get('/community/connections').expect(200);
      expect(list.body[0]).toMatchObject({ status: 'broken' });
      expect(list.body[0].statusReason).toMatch(/rejected the bot credentials/);
    });

    it('degrades rather than breaks on a transient failure, and recovers on the next check', async () => {
      const { connection } = await connect();
      discord.probe.mockRejectedValue(new CommunityRateLimitError('rate limited', 1000));

      const degraded = await api(app, adminCookie).get(`/community/connections/${connection.id}/health`).expect(200);
      expect(degraded.body.status).toBe('degraded');

      discord.probe.mockResolvedValue(PROBE);
      const recovered = await api(app, adminCookie).get(`/community/connections/${connection.id}/health`).expect(200);
      expect(recovered.body.status).toBe('active');

      const list = await api(app, adminCookie).get('/community/connections').expect(200);
      expect(list.body[0].statusReason).toBeUndefined();
    });

    it('refuses to re-check a connection that no longer exists', async () => {
      const { connection } = await connect();
      await api(app, adminCookie).delete(`/community/connections/${connection.id}`).expect(204);

      await api(app, adminCookie).get(`/community/connections/${connection.id}/health`).expect(404);
    });
  });

  describe('disconnect', () => {
    it('removes the bot from the community and deletes the connection', async () => {
      const { connection } = await connect();

      await api(app, adminCookie).delete(`/community/connections/${connection.id}`).expect(204);

      expect(discord.leaveGuild).toHaveBeenCalledWith(GUILD.id);

      const list = await api(app, adminCookie).get('/community/connections').expect(200);
      expect(list.body).toEqual([]);
      expect(await dataSource.getRepository(CommunityConnectionEntity).count()).toBe(0);
    });

    it('keeps the audit history after the connection row is gone', async () => {
      const { connection } = await connect();

      await api(app, adminCookie).delete(`/community/connections/${connection.id}`).expect(204);

      const auditRows = await dataSource.getRepository(CommunityConnectionAuditEntity).find();
      expect(auditRows.map((row) => row.action)).toEqual(
        expect.arrayContaining(['install_url', 'connect', 'disconnect']),
      );
      expect(auditRows.every((row) => row.connectionId === null)).toBe(true);
    });

    it('keeps the connection when the bot cannot be removed, so the admin can retry', async () => {
      const { connection } = await connect();
      discord.leaveGuild.mockRejectedValue(new CommunityAuthError('401: Unauthorized', 401));

      await api(app, adminCookie).delete(`/community/connections/${connection.id}`).expect(502);

      const list = await api(app, adminCookie).get('/community/connections').expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].status).toBe('broken');
    });

    it('reports an unknown connection', async () => {
      await api(app, adminCookie).delete('/community/connections/01940000-0000-7000-8000-000000000000').expect(404);
    });
  });

  describe('reconnect', () => {
    it('locks the authorization screen to the community being reconnected', async () => {
      const { connection } = await connect();

      const response = await api(app, adminCookie)
        .get(`/community/connections/discord/install-url?connectionId=${connection.id}`)
        .expect(200);

      expect(discord.buildInstallUrl).toHaveBeenLastCalledWith(expect.any(String), GUILD.id);
      expect(response.body.url).toContain('guild_id=');
    });

    it('leaves the picker open for a first-time connect', async () => {
      await api(app, adminCookie).get('/community/connections/discord/install-url').expect(200);

      expect(discord.buildInstallUrl).toHaveBeenLastCalledWith(expect.any(String), undefined);
    });

    it('rejects a malformed or unknown connection id', async () => {
      await api(app, adminCookie).get('/community/connections/discord/install-url?connectionId=not-a-uuid').expect(400);
      await api(app, adminCookie)
        .get('/community/connections/discord/install-url?connectionId=01940000-0000-7000-8000-000000000000')
        .expect(404);
    });
  });

  describe('auditing', () => {
    it('records the actor, action, and outcome of every privileged operation', async () => {
      const { connection } = await connect();
      await api(app, adminCookie).get(`/community/connections/${connection.id}/resources`).expect(200);
      await api(app, adminCookie).get(`/community/connections/${connection.id}/health`).expect(200);
      await api(app, adminCookie).delete(`/community/connections/${connection.id}`).expect(204);

      const rows = await dataSource.getRepository(CommunityConnectionAuditEntity).find({ order: { createdAt: 'ASC' } });

      expect(rows.map((row) => row.action)).toEqual([
        'install_url',
        'connect',
        'list_resources',
        'health_check',
        'disconnect',
      ]);
      for (const row of rows) {
        expect(row.platform).toBe('discord');
        expect(row.outcome).toBe('success');
        expect(row.actorUserId).toEqual(expect.any(String));
        expect(row.errorCategory).toBeNull();
      }
    });

    it('records a safe category on failure and never a platform body', async () => {
      const { connection } = await connect();
      discord.probe.mockRejectedValue(new CommunityAuthError('401: Unauthorized — bot token abc123 rejected', 401));

      await api(app, adminCookie).get(`/community/connections/${connection.id}/health`).expect(200);

      const row = await dataSource
        .getRepository(CommunityConnectionAuditEntity)
        .findOneOrFail({ where: { action: 'health_check' } });

      expect(row.outcome).toBe('failure');
      expect(row.errorCategory).toBe('auth_failed');
      expect(JSON.stringify(row)).not.toContain('abc123');
    });
  });

  describe('access control', () => {
    const routes: [string, string][] = [
      ['get', '/community/connections'],
      ['get', '/community/connections/discord/install-url'],
      ['get', '/community/connections/discord/callback?code=x&state=y'],
      ['get', '/community/connections/01940000-0000-7000-8000-000000000000/resources'],
      ['get', '/community/connections/01940000-0000-7000-8000-000000000000/health'],
      ['delete', '/community/connections/01940000-0000-7000-8000-000000000000'],
    ];

    it.each(routes)('rejects an unauthenticated %s %s with 401', async (method, path) => {
      await api(app)[method as 'get' | 'delete'](path).expect(401);
    });

    it('accepts both admin and owner sessions', async () => {
      await api(app, adminCookie).get('/community/connections').expect(200);
      await api(app, ownerCookie).get('/community/connections').expect(200);
    });
  });

  describe('response hygiene', () => {
    it('never returns a credential field on any route', async () => {
      const { connection } = await connect();
      const list = await api(app, adminCookie).get('/community/connections').expect(200);
      const resources = await api(app, adminCookie)
        .get(`/community/connections/${connection.id}/resources`)
        .expect(200);
      const health = await api(app, adminCookie).get(`/community/connections/${connection.id}/health`).expect(200);

      const payload = JSON.stringify([list.body, resources.body, health.body]);

      expect(payload).not.toContain('credentials');
      expect(payload).not.toContain('discord-bot-token');
      expect(payload).not.toContain('discord-client-secret');
      expect(Object.keys(list.body[0]).sort()).toEqual([
        'createdAt',
        'externalId',
        'id',
        'lastCheckedAt',
        'name',
        'platform',
        'status',
        'updatedAt',
      ]);
    });
  });
});
