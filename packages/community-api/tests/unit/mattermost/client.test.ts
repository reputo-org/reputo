import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createMattermostClient } from '../../../src/mattermost/client.js';
import type { MattermostClientConfig } from '../../../src/mattermost/types.js';
import {
  CommunityAuthError,
  CommunityContractError,
  CommunityOutboundPolicyError,
  CommunityPermissionError,
} from '../../../src/shared/errors.js';
import { createStubLogger, TEST_HTTP_CONFIG } from '../../utils/mock-helpers.js';

const TOKEN = 'mm-secret-token';
const TEAMS = [
  { id: 'team-1', name: 'snet', display_name: 'SingularityNET', delete_at: 0 },
  { id: 'team-2', name: 'labs', display_name: 'Labs', delete_at: 0 },
];
const CHANNELS = [
  { id: 'chan-1', name: 'town-square', display_name: 'Town Square', type: 'O', delete_at: 0 },
  { id: 'chan-2', name: 'private', display_name: 'Backstage', type: 'P', delete_at: 0 },
];
const POSTS = {
  order: ['p1'],
  posts: { p1: { id: 'p1', user_id: 'u1', create_at: 1700000000000, message: 'never read' } },
};

interface RecordedRequest {
  url: string;
  authorization?: string;
}

/**
 * Fake Mattermost v4 server. `deny` switches whole routes to an error so the
 * tests can flip auth and permission outcomes per case.
 */
describe('createMattermostClient', () => {
  let server: Server;
  let serverUrl: string;
  const requests: RecordedRequest[] = [];
  const deny = { auth: false, channelPosts: new Set<string>(), htmlEverything: false };

  const client = () =>
    createMattermostClient(
      {
        ...TEST_HTTP_CONFIG,
        outbound: { allowedHosts: ['127.0.0.1'], maxResponseBytes: 65536 },
      } satisfies MattermostClientConfig,
      createStubLogger(),
    );

  const target = () => ({ serverUrl, token: TOKEN });
  const teamTarget = () => ({ ...target(), teamId: 'team-1' });

  const handle = (request: IncomingMessage, response: ServerResponse): void => {
    requests.push({ url: request.url ?? '', authorization: request.headers.authorization });

    if (deny.htmlEverything) {
      response.setHeader('content-type', 'text/html');
      response.end('<html><body>login page</body></html>');
      return;
    }
    if (deny.auth || request.headers.authorization !== `Bearer ${TOKEN}`) {
      response.statusCode = 401;
      response.end(JSON.stringify({ id: 'api.context.session_expired.app_error' }));
      return;
    }

    const url = request.url ?? '';
    const respond = (body: unknown): void => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(body));
    };

    if (url === '/api/v4/users/me') {
      respond({ id: 'bot-1', username: 'reputo-bot' });
    } else if (url === '/api/v4/users/me/teams') {
      respond(TEAMS);
    } else if (url === '/api/v4/users/me/teams/team-1/channels') {
      respond(CHANNELS);
    } else if (url.startsWith('/api/v4/channels/') && url.includes('/posts')) {
      const channelId = url.split('/')[4];
      if (deny.channelPosts.has(channelId)) {
        response.statusCode = 403;
        response.end(JSON.stringify({ id: 'api.context.permissions.app_error' }));
      } else {
        respond(POSTS);
      }
    } else {
      response.statusCode = 404;
      response.end(JSON.stringify({ id: 'api.context.404.app_error' }));
    }
  };

  beforeAll(async () => {
    server = createServer(handle);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    serverUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  beforeEach(() => {
    requests.length = 0;
    deny.auth = false;
    deny.htmlEverything = false;
    deny.channelPosts.clear();
  });

  describe('validateToken', () => {
    it('verifies the token, lists its teams, and returns the canonical origin', async () => {
      const result = await client().validateToken({ serverUrl: `${serverUrl}/some/pasted/path`, token: TOKEN });

      expect(result.serverUrl).toBe(serverUrl);
      expect(result.teams).toEqual([
        { id: 'team-1', name: 'snet', displayName: 'SingularityNET' },
        { id: 'team-2', name: 'labs', displayName: 'Labs' },
      ]);
      expect(requests.map((entry) => entry.url)).toEqual(['/api/v4/users/me', '/api/v4/users/me/teams']);
    });

    it('sends the token only as a bearer header, never in the URL', async () => {
      await client().validateToken(target());

      for (const entry of requests) {
        expect(entry.authorization).toBe(`Bearer ${TOKEN}`);
        expect(entry.url).not.toContain(TOKEN);
      }
    });

    it('surfaces a rejected token as an auth failure', async () => {
      deny.auth = true;

      await expect(client().validateToken(target())).rejects.toBeInstanceOf(CommunityAuthError);
    });

    it('reports a non-Mattermost answer as a contract failure without quoting it', async () => {
      deny.htmlEverything = true;

      const failure = await client()
        .validateToken(target())
        .then(
          () => null,
          (error: Error) => error,
        );

      expect(failure).toBeInstanceOf(CommunityContractError);
      expect(failure?.message).not.toContain('login page');
    });

    it('refuses a private target before any request is made', async () => {
      await expect(
        client().validateToken({ serverUrl: 'https://169.254.169.254', token: TOKEN }),
      ).rejects.toBeInstanceOf(CommunityOutboundPolicyError);
      expect(requests).toHaveLength(0);
    });
  });

  describe('listResources', () => {
    it('lists the channels the bot is in', async () => {
      const resources = await client().listResources(teamTarget());

      expect(resources).toEqual([
        { id: 'chan-2', name: 'Backstage', kind: 'text' },
        { id: 'chan-1', name: 'Town Square', kind: 'text' },
      ]);
    });
  });

  describe('probe', () => {
    it('lists channels, reads one page of posts, and keeps only counts', async () => {
      const probe = await client().probe(teamTarget());

      expect(probe).toEqual({ resourceCount: 2, sampledResourceId: 'chan-2', sampledRecordCount: 1 });
    });

    it('moves past a channel it cannot read', async () => {
      deny.channelPosts.add('chan-2');

      const probe = await client().probe(teamTarget());

      expect(probe.sampledResourceId).toBe('chan-1');
    });

    it('fails as a permission problem when no channel is readable', async () => {
      deny.channelPosts.add('chan-1');
      deny.channelPosts.add('chan-2');

      await expect(client().probe(teamTarget())).rejects.toBeInstanceOf(CommunityPermissionError);
    });
  });
});
