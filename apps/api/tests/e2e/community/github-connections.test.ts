import type { INestApplication } from '@nestjs/common';
import { CommunityAuthError, CommunityPermissionError } from '@reputo/community-api';
import type { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommunityConnectionAuditEntity, CommunityConnectionEntity } from '../../../src/persistence';
import { createTestApp } from '../../utils/app-test.module';
import { createAuthenticatedSession } from '../../utils/auth-session';
import { getTestDataSource } from '../../utils/db';
import { api } from '../../utils/request';

const INSTALLATION = { id: '55', account: 'singnet' };
const REPOSITORIES = [
  { id: '1', name: 'singnet/snet', kind: 'repository' as const },
  { id: '2', name: 'singnet/docs', kind: 'repository' as const },
];
const PROBE = { resourceCount: 2, sampledResourceId: '1', sampledRecordCount: 1 };

const github = {
  buildInstallUrl: vi.fn(
    (state: string) => `https://github.com/apps/reputo-community/installations/new?state=${state}`,
  ),
  confirmInstallation: vi.fn(async () => INSTALLATION),
  listResources: vi.fn(async () => REPOSITORIES),
  probe: vi.fn(async () => PROBE),
  deleteInstallation: vi.fn(async () => undefined),
};

describe('GitHub community connections e2e', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminCookie: string;

  /** Runs the full connect flow and returns the created connection. */
  async function connect(installationId = INSTALLATION.id) {
    const installUrl = await api(app, adminCookie).get('/community/connections/github/install-url').expect(200);
    const state = new URL(installUrl.body.url).searchParams.get('state') as string;

    const callback = await api(app, adminCookie)
      .get(
        `/community/connections/github/callback?installation_id=${installationId}&setup_action=install&state=${encodeURIComponent(state)}`,
      )
      .expect(302);

    const list = await api(app, adminCookie).get('/community/connections').expect(200);

    return { callback, connection: list.body[0], connections: list.body };
  }

  beforeAll(async () => {
    const boot = await createTestApp({ githubClient: github });
    app = boot.app;
    dataSource = getTestDataSource(boot.moduleRef);
    adminCookie = (await createAuthenticatedSession(boot.moduleRef, { role: 'admin' })).cookie;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    github.confirmInstallation.mockResolvedValue(INSTALLATION);
    github.listResources.mockResolvedValue(REPOSITORIES);
    github.probe.mockResolvedValue(PROBE);
    github.deleteInstallation.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await dataSource.query('TRUNCATE TABLE community_connection_audit, community_connections CASCADE');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('connect', () => {
    it('probes the installation and lands an active connection keyed by installation id', async () => {
      const { callback, connection } = await connect();

      expect(callback.headers.location).toBe('http://localhost:5173/community?connected=github');
      expect(connection).toMatchObject({
        platform: 'github',
        externalId: INSTALLATION.id,
        name: INSTALLATION.account,
        status: 'active',
      });
      expect(github.confirmInstallation).toHaveBeenCalledWith(INSTALLATION.id);
      expect(github.probe).toHaveBeenCalledWith(INSTALLATION.id);
    });

    it('confirms the installation with GitHub rather than trusting the redirect', async () => {
      github.confirmInstallation.mockRejectedValue(
        new CommunityAuthError('GitHub does not report this installation for the Reputo App.', 404),
      );

      const { callback, connections } = await connect('forged');

      expect(callback.headers.location).toBe('http://localhost:5173/community?error=auth_failed&platform=github');
      expect(connections).toEqual([]);
      expect(await dataSource.getRepository(CommunityConnectionEntity).count()).toBe(0);
    });

    it('accepts the user-authorization code an OAuth-enabled App appends', async () => {
      const installUrl = await api(app, adminCookie).get('/community/connections/github/install-url').expect(200);
      const state = new URL(installUrl.body.url).searchParams.get('state') as string;

      const callback = await api(app, adminCookie)
        .get(
          `/community/connections/github/callback?code=abc123&installation_id=${INSTALLATION.id}&setup_action=install&state=${encodeURIComponent(state)}`,
        )
        .expect(302);

      expect(callback.headers.location).toBe('http://localhost:5173/community?connected=github');
      // The code is never exchanged; the installation is confirmed with the app JWT.
      expect(github.confirmInstallation).toHaveBeenCalledWith(INSTALLATION.id);
    });

    it('updates the same installation instead of creating a second connection', async () => {
      await connect();
      github.confirmInstallation.mockResolvedValue({ ...INSTALLATION, account: 'singnet-renamed' });

      const { connections } = await connect();

      expect(connections).toHaveLength(1);
      expect(connections[0].name).toBe('singnet-renamed');
    });

    it('redirects with invalid_state when the state is missing, forged, or replayed', async () => {
      for (const query of ['installation_id=55', 'installation_id=55&state=forged', 'state=forged']) {
        const response = await api(app, adminCookie).get(`/community/connections/github/callback?${query}`).expect(302);

        expect(response.headers.location).toBe('http://localhost:5173/community?error=invalid_state&platform=github');
      }
      expect(github.confirmInstallation).not.toHaveBeenCalled();
    });

    it('separates a cancelled install from one an owner must still approve', async () => {
      const installUrl = await api(app, adminCookie).get('/community/connections/github/install-url').expect(200);
      const state = new URL(installUrl.body.url).searchParams.get('state') as string;

      const cancelled = await api(app, adminCookie)
        .get(`/community/connections/github/callback?state=${encodeURIComponent(state)}`)
        .expect(302);
      expect(cancelled.headers.location).toBe('http://localhost:5173/community?error=declined&platform=github');

      const requested = await api(app, adminCookie)
        .get(`/community/connections/github/callback?setup_action=request&state=${encodeURIComponent(state)}`)
        .expect(302);
      expect(requested.headers.location).toBe(
        'http://localhost:5173/community?error=approval_required&platform=github',
      );
      expect(github.confirmInstallation).not.toHaveBeenCalled();
    });

    it('breaks the connection when the probe finds no readable repository', async () => {
      github.probe.mockRejectedValue(
        new CommunityPermissionError('The GitHub App installation grants access to no repositories.', 403),
      );

      const { callback, connection } = await connect();

      expect(callback.headers.location).toBe('http://localhost:5173/community?error=permission_denied&platform=github');
      expect(connection.status).toBe('broken');
      expect(connection.statusReason).toMatch(/read access to issues and pull requests/);
    });
  });

  describe('resources, health, and disconnect', () => {
    it('lists the repositories of an active connection', async () => {
      const { connection } = await connect();

      const response = await api(app, adminCookie).get(`/community/connections/${connection.id}/resources`).expect(200);

      expect(response.body).toEqual(REPOSITORIES);
      expect(github.listResources).toHaveBeenCalledWith(INSTALLATION.id);
    });

    /** Acceptance criterion: uninstalling the App flips the connection on re-check. */
    it('flips an uninstalled App to broken on the next check', async () => {
      const { connection } = await connect();
      github.probe.mockRejectedValue(new CommunityAuthError('GitHub rejected the App credentials.', 401));

      const response = await api(app, adminCookie).get(`/community/connections/${connection.id}/health`).expect(200);

      expect(response.body.status).toBe('broken');
      expect(response.body.reason).toMatch(/rejected Reputo's credentials/);

      const list = await api(app, adminCookie).get('/community/connections').expect(200);
      expect(list.body[0].status).toBe('broken');
    });

    it('uninstalls the App and deletes the connection', async () => {
      const { connection } = await connect();

      await api(app, adminCookie).delete(`/community/connections/${connection.id}`).expect(204);

      expect(github.deleteInstallation).toHaveBeenCalledWith(INSTALLATION.id);
      expect(await dataSource.getRepository(CommunityConnectionEntity).count()).toBe(0);
    });

    it('keeps the connection when the App cannot be uninstalled, so the admin can retry', async () => {
      const { connection } = await connect();
      github.deleteInstallation.mockRejectedValue(new CommunityAuthError('401: Unauthorized', 401));

      await api(app, adminCookie).delete(`/community/connections/${connection.id}`).expect(502);

      const list = await api(app, adminCookie).get('/community/connections').expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].status).toBe('broken');
    });
  });

  describe('reconnect and auditing', () => {
    it('refuses to reconnect a connection of another platform', async () => {
      const { connection } = await connect();
      await dataSource.getRepository(CommunityConnectionEntity).update(connection.id, { platform: 'discord' });

      await api(app, adminCookie)
        .get(`/community/connections/github/install-url?connectionId=${connection.id}`)
        .expect(400);
    });

    it('records the actor, action, and platform of every privileged operation', async () => {
      const { connection } = await connect();
      await api(app, adminCookie).get(`/community/connections/${connection.id}/resources`).expect(200);
      await api(app, adminCookie).delete(`/community/connections/${connection.id}`).expect(204);

      const rows = await dataSource.getRepository(CommunityConnectionAuditEntity).find({ order: { createdAt: 'ASC' } });

      expect(rows.map((row) => row.action)).toEqual(['install_url', 'connect', 'list_resources', 'disconnect']);
      for (const row of rows) {
        expect(row.platform).toBe('github');
        expect(row.outcome).toBe('success');
        expect(row.errorCategory).toBeNull();
      }
    });

    it('never returns a credential field on any route', async () => {
      const { connection } = await connect();
      const list = await api(app, adminCookie).get('/community/connections').expect(200);
      const resources = await api(app, adminCookie)
        .get(`/community/connections/${connection.id}/resources`)
        .expect(200);

      const payload = JSON.stringify([list.body, resources.body]);

      expect(payload).not.toContain('credentials');
      expect(payload).not.toContain('PRIVATE KEY');
    });
  });

  describe('access control', () => {
    const routes = [
      '/community/connections/github/install-url',
      '/community/connections/github/callback?installation_id=55&state=y',
    ];

    it.each(routes)('rejects an unauthenticated GET %s with 401', async (path) => {
      await api(app).get(path).expect(401);
    });
  });
});
