import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { openCommunityCredential, sealCommunityCredential } from '@reputo/community-api';
import type { DataSource } from 'typeorm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CommunityConnectionAuditEntity, CommunityConnectionEntity } from '../../../src/persistence';
import { createTestApp } from '../../utils/app-test.module';
import { AUTH_TEST_ENV, createAuthenticatedSession } from '../../utils/auth-session';
import { getTestDataSource } from '../../utils/db';
import { api } from '../../utils/request';

const TOKEN = 'mm-e2e-bot-token-do-not-leak';
const KEYRING = { currentSecret: AUTH_TEST_ENV.COMMUNITY_CREDENTIALS_ENCRYPTION_KEY };
const TEAMS = [
  { id: 'team-1', name: 'snet', display_name: 'SingularityNET', delete_at: 0 },
  { id: 'team-2', name: 'empty', display_name: 'Empty Team', delete_at: 0 },
];
const CHANNELS = [{ id: 'chan-1', name: 'town-square', display_name: 'Town Square', type: 'O', delete_at: 0 }];
const POSTS = { order: ['p1'], posts: { p1: { id: 'p1', user_id: 'u1', create_at: 1700000000000 } } };

type ServerMode = 'ok' | 'reject-token' | 'redirect' | 'huge';

/**
 * The suite runs the REAL Mattermost client against this fake v4 server on
 * loopback (the one allowlisted host), so the outbound policy, sealing, and
 * transport are all under test — no platform double.
 */
describe('Mattermost community connections e2e', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let adminCookie: string;
  let server: Server;
  let serverUrl: string;
  let mode: ServerMode = 'ok';
  const logLines: string[] = [];

  const handle = (request: IncomingMessage, response: ServerResponse): void => {
    if (mode === 'redirect') {
      response.statusCode = 302;
      response.setHeader('location', 'http://169.254.169.254/latest/meta-data');
      response.end();
      return;
    }
    if (mode === 'huge') {
      response.setHeader('content-type', 'application/json');
      response.end(`{"blob":"${'x'.repeat(70_000)}"}`);
      return;
    }
    if (mode === 'reject-token' || request.headers.authorization !== `Bearer ${TOKEN}`) {
      response.statusCode = 401;
      response.end(JSON.stringify({ id: 'api.context.session_expired.app_error' }));
      return;
    }

    const respond = (body: unknown): void => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(body));
    };
    const url = request.url ?? '';
    if (url === '/api/v4/users/me') {
      respond({ id: 'bot-1', username: 'reputo-bot' });
    } else if (url === '/api/v4/users/me/teams') {
      respond(TEAMS);
    } else if (url === '/api/v4/users/me/teams/team-1/channels') {
      respond(CHANNELS);
    } else if (url === '/api/v4/users/me/teams/team-2/channels') {
      respond([]);
    } else if (url.startsWith('/api/v4/teams/team-1/channels?') || url.startsWith('/api/v4/teams/team-2/channels?')) {
      respond([]);
    } else if (url.startsWith('/api/v4/channels/chan-1/posts')) {
      respond(POSTS);
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ id: 'api.context.404.app_error' }));
    }
  };

  const validate = (body: Record<string, string>) =>
    api(app, adminCookie).post('/community/connections/mattermost/validate').send(body);
  const connect = (body: Record<string, string>) =>
    api(app, adminCookie).post('/community/connections/mattermost/connect').send(body);

  async function connectTeamOne() {
    const response = await connect({ serverUrl, token: TOKEN, teamId: 'team-1' }).expect(201);
    return response.body as { id: string; externalId: string; status: string };
  }

  beforeAll(async () => {
    server = createServer(handle);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const boot = await createTestApp({
      mattermostClient: 'real',
      logStream: { write: (line: string) => void logLines.push(line) },
    });
    app = boot.app;
    dataSource = getTestDataSource(boot.moduleRef);
    adminCookie = (await createAuthenticatedSession(boot.moduleRef, { role: 'admin' })).cookie;
  });

  beforeEach(() => {
    mode = 'ok';
  });

  afterEach(async () => {
    await dataSource.query('TRUNCATE TABLE community_connection_audit, community_connections CASCADE');
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  describe('validate', () => {
    it("returns the token's teams and stores nothing", async () => {
      const response = await validate({ serverUrl, token: TOKEN }).expect(200);

      expect(response.body).toEqual({
        teams: [
          { id: 'team-1', name: 'snet', displayName: 'SingularityNET' },
          { id: 'team-2', name: 'empty', displayName: 'Empty Team' },
        ],
      });
      expect(await dataSource.getRepository(CommunityConnectionEntity).count()).toBe(0);
    });

    it('answers a wrong token with a readable reason code and stores nothing', async () => {
      mode = 'reject-token';

      const response = await validate({ serverUrl, token: 'wrong' }).expect(400);

      expect(response.body.message).toBe('auth_failed');
      expect(JSON.stringify(response.body)).not.toContain('wrong');
      expect(await dataSource.getRepository(CommunityConnectionEntity).count()).toBe(0);
    });
  });

  describe('connect', () => {
    it('seals the token, probes, and lands an active connection keyed by origin and team', async () => {
      const connection = await connectTeamOne();

      expect(connection).toMatchObject({
        platform: 'mattermost',
        externalId: `${serverUrl}/team-1`,
        name: 'SingularityNET',
        status: 'active',
      });

      const row = await dataSource.getRepository(CommunityConnectionEntity).findOneByOrFail({ id: connection.id });
      expect(row.credentialsCiphertext).toMatch(/^ccv1:/);
      expect(row.credentialsCiphertext).not.toContain(TOKEN);
      expect(
        openCommunityCredential(
          KEYRING,
          { platform: 'mattermost', externalId: row.externalId },
          row.credentialsCiphertext as string,
        ),
      ).toBe(TOKEN);
    });

    it('keeps http and https connections to the same host apart', async () => {
      const twins = dataSource.getRepository(CommunityConnectionEntity);
      const httpsTwin = `https://${new URL(serverUrl).host}/team-1`;
      await twins.save(
        twins.create({
          platform: 'mattermost',
          externalId: httpsTwin,
          name: 'SingularityNET (https)',
          status: 'broken',
          settings: null,
          credentialsCiphertext: null,
        }),
      );

      await connectTeamOne();

      const rows = await dataSource.getRepository(CommunityConnectionEntity).find();
      expect(rows.map((row) => row.externalId).sort()).toEqual([`${serverUrl}/team-1`, httpsTwin].sort());
    });

    it('refuses a team the token does not belong to', async () => {
      const response = await connect({ serverUrl, token: TOKEN, teamId: 'not-mine' }).expect(400);

      expect(response.body.message).toBe('team_not_found');
      expect(await dataSource.getRepository(CommunityConnectionEntity).count()).toBe(0);
    });

    it('keeps the connection with a broken state when the probe finds nothing readable', async () => {
      const response = await connect({ serverUrl, token: TOKEN, teamId: 'team-2' }).expect(400);

      expect(response.body.message).toBe('permission_denied');
      const list = await api(app, adminCookie).get('/community/connections').expect(200);
      expect(list.body[0]).toMatchObject({ platform: 'mattermost', status: 'broken' });
    });
  });

  describe('resources and health through the sealed credential', () => {
    it('lists channels by unsealing the token at the outbound call', async () => {
      const connection = await connectTeamOne();

      const response = await api(app, adminCookie).get(`/community/connections/${connection.id}/resources`).expect(200);

      expect(response.body).toEqual([{ id: 'chan-1', name: 'Town Square', kind: 'text', readable: true }]);
    });

    it('re-checks health with the sealed token', async () => {
      const connection = await connectTeamOne();

      const response = await api(app, adminCookie).get(`/community/connections/${connection.id}/health`).expect(200);

      expect(response.body.status).toBe('active');
    });

    it('breaks the connection when the stored ciphertext belongs to another row (AAD)', async () => {
      const connection = await connectTeamOne();
      const foreign = sealCommunityCredential(
        KEYRING,
        { platform: 'mattermost', externalId: 'https://other.example.com/team-9' },
        TOKEN,
      );
      await dataSource
        .getRepository(CommunityConnectionEntity)
        .update(connection.id, { credentialsCiphertext: foreign });

      const response = await api(app, adminCookie).get(`/community/connections/${connection.id}/health`).expect(200);

      expect(response.body.status).toBe('broken');
      expect(response.body.reason).toMatch(/rejected the token|credentials/i);
    });
  });

  describe('SSRF suite', () => {
    const blockedUrls = [
      'http://127.0.0.2:8065', // loopback (127.0.0.1 itself is the allowlisted test host)
      'https://10.0.0.8',
      'https://192.168.1.10:8065',
      'https://[::1]:8065',
      'https://[::ffff:127.0.0.1]', // URL rewrites this to ::ffff:7f00:1
      'https://169.254.169.254/latest/meta-data',
      'http://localhost:8065', // resolves to loopback; also plain http off the allowlist
      'http://public.example.com', // https requirement, refused before any DNS or socket work
    ];

    it.each(blockedUrls)('rejects %s at the validate call site', async (url) => {
      const response = await validate({ serverUrl: url, token: TOKEN }).expect(400);
      expect(response.body.message).toBe('outbound_policy');
    });

    it.each(['https://169.254.169.254', 'https://10.0.0.8'])('rejects %s at the connect call site', async (url) => {
      const response = await connect({ serverUrl: url, token: TOKEN, teamId: 'team-1' }).expect(400);
      expect(response.body.message).toBe('outbound_policy');
      expect(await dataSource.getRepository(CommunityConnectionEntity).count()).toBe(0);
    });

    it('rejects a stored connection whose origin turned private at the health and resources call sites', async () => {
      // A connection whose stored origin now violates policy — the DNS-rebinding
      // aftermath: the policy must hold on every later call, not just at connect.
      const privateExternalId = 'https://169.254.169.254/team-1';
      const repository = dataSource.getRepository(CommunityConnectionEntity);
      await repository.save(
        repository.create({
          platform: 'mattermost',
          externalId: privateExternalId,
          name: 'Rebound',
          status: 'active',
          settings: null,
          credentialsCiphertext: sealCommunityCredential(
            KEYRING,
            { platform: 'mattermost', externalId: privateExternalId },
            TOKEN,
          ),
        }),
      );
      const list = await api(app, adminCookie).get('/community/connections').expect(200);
      const id = list.body[0].id;

      const health = await api(app, adminCookie).get(`/community/connections/${id}/health`).expect(200);
      expect(health.body.status).toBe('broken');
      expect(health.body.reason).toMatch(/outbound network policy/);

      await api(app, adminCookie).get(`/community/connections/${id}/resources`).expect(502);
    });

    it('refuses a redirecting server instead of following it', async () => {
      mode = 'redirect';

      const response = await validate({ serverUrl, token: TOKEN }).expect(400);
      expect(response.body.message).toBe('outbound_policy');
    });

    it('refuses an oversized response', async () => {
      mode = 'huge';

      const response = await validate({ serverUrl, token: TOKEN }).expect(400);
      expect(response.body.message).toBe('outbound_policy');
    });
  });

  describe('secret-leak regression', () => {
    it('keeps the token out of every response, log line, and stored row', async () => {
      logLines.length = 0;
      const bodies: string[] = [];

      mode = 'reject-token';
      bodies.push(JSON.stringify((await validate({ serverUrl, token: TOKEN }).expect(400)).body));
      mode = 'ok';
      bodies.push(JSON.stringify((await validate({ serverUrl, token: TOKEN }).expect(200)).body));
      const connection = await connectTeamOne();
      bodies.push(JSON.stringify(connection));
      bodies.push(
        JSON.stringify(
          (await api(app, adminCookie).get(`/community/connections/${connection.id}/resources`).expect(200)).body,
        ),
      );
      bodies.push(
        JSON.stringify(
          (await api(app, adminCookie).get(`/community/connections/${connection.id}/health`).expect(200)).body,
        ),
      );
      bodies.push(JSON.stringify((await api(app, adminCookie).get('/community/connections').expect(200)).body));

      for (const body of bodies) {
        expect(body).not.toContain(TOKEN);
        expect(body).not.toContain('credentials');
      }
      expect(logLines.length).toBeGreaterThan(0);
      for (const line of logLines) {
        expect(line).not.toContain(TOKEN);
      }

      // No community workflow exists yet (the fetch lands with the scoring
      // task), so nothing can enter Temporal history here; the worker reads the
      // ciphertext straight from Postgres by design. The durable rows must
      // still be clean:
      const audits = await dataSource.getRepository(CommunityConnectionAuditEntity).find();
      expect(JSON.stringify(audits)).not.toContain(TOKEN);
    });
  });

  describe('access control', () => {
    it.each(['validate', 'connect'])('rejects an unauthenticated POST mattermost/%s with 401', async (route) => {
      await api(app).post(`/community/connections/mattermost/${route}`).send({}).expect(401);
    });

    it('rejects a payload with unknown fields', async () => {
      await validate({ serverUrl, token: TOKEN, extra: 'nope' }).expect(400);
    });
  });
});
