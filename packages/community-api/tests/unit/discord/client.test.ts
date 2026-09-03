import { request } from 'undici';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiscordClient } from '../../../src/discord/client.js';
import { CommunityAuthError, CommunityContractError, CommunityPermissionError } from '../../../src/shared/errors.js';
import { createStubLogger, mockUndiciResponse, TEST_DISCORD_CONFIG } from '../../utils/mock-helpers.js';

vi.mock('undici', () => ({ request: vi.fn() }));

const mockRequest = vi.mocked(request);
const client = createDiscordClient(TEST_DISCORD_CONFIG, createStubLogger());

const channel = (id: string, type = 0, permissionOverwrites: unknown[] = []) => ({
  id,
  name: `channel-${id}`,
  type,
  position: Number(id),
  permission_overwrites: permissionOverwrites,
});
const message = { id: 'm1', timestamp: '2026-08-01T00:00:00.000+00:00', author: { id: '42' } };

/** View Channel (1 << 10) plus Read Message History (1 << 16). */
const READ_PERMISSIONS = '66560';
const NO_PERMISSIONS = '0';

const lastCall = () => mockRequest.mock.calls.at(-1) as [string, { headers?: Record<string, string>; body?: string }];

/**
 * Queues the listing calls in the order the adapter issues them: the bot user
 * (once per client, cached), then the guild channels, the bot member, and the
 * guild roles in parallel.
 */
function mockListing(channels: unknown[], options: { botUser?: boolean; basePermissions?: string } = {}) {
  if (options.botUser !== false) {
    mockRequest.mockResolvedValueOnce(mockUndiciResponse(200, { id: 'bot-1' }) as never);
  }
  mockRequest
    .mockResolvedValueOnce(mockUndiciResponse(200, channels) as never)
    .mockResolvedValueOnce(mockUndiciResponse(200, { roles: ['bot-role'] }) as never)
    .mockResolvedValueOnce(
      mockUndiciResponse(200, [
        { id: 'guild-1', permissions: NO_PERMISSIONS },
        { id: 'bot-role', permissions: options.basePermissions ?? READ_PERMISSIONS },
      ]) as never,
    );
}

const listingCalls = () => mockRequest.mock.calls.map((call) => call[0]);

describe('exchangeCode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('posts a form-encoded exchange and returns the installed guild', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(200, { guild: { id: '9', name: 'SNET' } }) as never);

    const guild = await client.exchangeCode('the-code');

    expect(guild).toEqual({ id: '9', name: 'SNET' });

    const [url, options] = lastCall();
    expect(url).toBe('https://discord.com/api/v10/oauth2/token');
    expect(options.headers?.['content-type']).toBe('application/x-www-form-urlencoded');

    const body = new URLSearchParams(options.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('redirect_uri')).toBe(TEST_DISCORD_CONFIG.callbackUrl);
  });

  it('reports a rejected code as an auth failure', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(400, { error: 'invalid_grant' }) as never);

    await expect(client.exchangeCode('replayed')).rejects.toBeInstanceOf(CommunityAuthError);
  });
});

describe('listResources', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads the guild channels, the bot member, and the roles with the bot credential', async () => {
    const listingClient = createDiscordClient(TEST_DISCORD_CONFIG, createStubLogger());
    mockListing([channel('1'), channel('2', 15)]);

    const resources = await listingClient.listResources('guild-1');

    expect(resources).toEqual([
      { id: '1', name: 'channel-1', kind: 'text', readable: true },
      { id: '2', name: 'channel-2', kind: 'forum', readable: true },
    ]);
    expect(listingCalls()).toEqual([
      'https://discord.com/api/v10/users/@me',
      'https://discord.com/api/v10/guilds/guild-1/channels',
      'https://discord.com/api/v10/guilds/guild-1/members/bot-1',
      'https://discord.com/api/v10/guilds/guild-1/roles',
    ]);
    for (const [, options] of mockRequest.mock.calls as Array<[string, { headers?: Record<string, string> }]>) {
      expect(options.headers?.authorization).toBe(`Bot ${TEST_DISCORD_CONFIG.botToken}`);
    }
  });

  it('marks a channel whose overwrites hide it from the bot as unreadable, naming the missing permission', async () => {
    const listingClient = createDiscordClient(TEST_DISCORD_CONFIG, createStubLogger());
    mockListing([
      channel('1'),
      channel('2', 0, [{ id: 'guild-1', type: 0, allow: '0', deny: '1024' }]),
      channel('3', 0, [{ id: 'bot-role', type: 0, allow: '0', deny: '65536' }]),
    ]);

    const resources = await listingClient.listResources('guild-1');

    expect(resources).toEqual([
      { id: '1', name: 'channel-1', kind: 'text', readable: true },
      { id: '2', name: 'channel-2', kind: 'text', readable: false, accessIssue: 'missing_view_channel' },
      { id: '3', name: 'channel-3', kind: 'text', readable: false, accessIssue: 'missing_read_history' },
    ]);
  });

  it('looks the bot user up once and reuses it across guild listings', async () => {
    const listingClient = createDiscordClient(TEST_DISCORD_CONFIG, createStubLogger());
    mockListing([channel('1')]);
    mockListing([channel('1')], { botUser: false });

    await listingClient.listResources('guild-1');
    await listingClient.listResources('guild-1');

    expect(listingCalls().filter((url) => url.endsWith('/users/@me'))).toHaveLength(1);
  });

  it('surfaces a revoked bot as an auth failure', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(401, { message: '401: Unauthorized' }) as never);

    await expect(client.listResources('guild-1')).rejects.toBeInstanceOf(CommunityAuthError);
  });
});

describe('leaveGuild', () => {
  beforeEach(() => vi.clearAllMocks());

  it('removes the bot with the guild-leave endpoint', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(204, '') as never);

    await client.leaveGuild('guild-1');

    const [url, options] = lastCall();
    expect(url).toBe('https://discord.com/api/v10/users/@me/guilds/guild-1');
    expect(options.headers?.authorization).toBe(`Bot ${TEST_DISCORD_CONFIG.botToken}`);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('succeeds when the bot is no longer in the guild', async () => {
    for (const status of [403, 404]) {
      vi.clearAllMocks();
      mockRequest.mockResolvedValue(mockUndiciResponse(status, { message: 'Unknown Guild' }) as never);

      await expect(client.leaveGuild('guild-1')).resolves.toBeUndefined();
    }
  });

  it('surfaces a rejected credential rather than reporting success', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(401, { message: '401: Unauthorized' }) as never);

    await expect(client.leaveGuild('guild-1')).rejects.toBeInstanceOf(CommunityAuthError);
  });
});

describe('probe', () => {
  beforeEach(() => vi.clearAllMocks());

  const probeClient = () => createDiscordClient(TEST_DISCORD_CONFIG, createStubLogger());

  it('reads a single page of history from the first readable channel', async () => {
    mockListing([channel('1'), channel('2')]);
    mockRequest
      .mockResolvedValueOnce(mockUndiciResponse(200, [message]) as never)
      .mockResolvedValueOnce(mockUndiciResponse(200, { icon: 'abc123', approximate_member_count: 250 }) as never);

    const result = await probeClient().probe('guild-1');

    expect(result).toEqual({
      resourceCount: 2,
      readableResourceCount: 2,
      resourcesDigest: expect.stringMatching(/^[0-9a-f]{16}$/),
      sampledResourceId: '1',
      sampledRecordCount: 1,
      profile: {
        avatarUrl: 'https://cdn.discordapp.com/icons/guild-1/abc123.png?size=128',
        memberCount: 250,
      },
    });
    expect(mockRequest.mock.calls[4]?.[0]).toBe('https://discord.com/api/v10/channels/1/messages?limit=1');
    expect(lastCall()[0]).toBe('https://discord.com/api/v10/guilds/guild-1?with_counts=true');
    expect(mockRequest).toHaveBeenCalledTimes(6);
  });

  it('keeps the probe result when the guild profile lookup fails', async () => {
    mockListing([channel('1')]);
    mockRequest
      .mockResolvedValueOnce(mockUndiciResponse(200, [message]) as never)
      .mockResolvedValueOnce(mockUndiciResponse(403, { message: 'Missing Access' }) as never);

    const result = await probeClient().probe('guild-1');

    expect(result.sampledResourceId).toBe('1');
    expect(result.profile).toBeUndefined();
  });

  it('never samples a channel the permission model says the bot cannot read', async () => {
    mockListing([channel('1', 0, [{ id: 'guild-1', type: 0, allow: '0', deny: '66560' }]), channel('2')]);
    mockRequest
      .mockResolvedValueOnce(mockUndiciResponse(200, []) as never)
      .mockResolvedValueOnce(mockUndiciResponse(200, {}) as never);

    const result = await probeClient().probe('guild-1');

    expect(result.sampledResourceId).toBe('2');
    expect(result.sampledRecordCount).toBe(0);
    expect(result.readableResourceCount).toBe(1);
    expect(listingCalls()).not.toContain('https://discord.com/api/v10/channels/1/messages?limit=1');
  });

  it('skips a readable-looking channel Discord still refuses and samples the next one', async () => {
    mockListing([channel('1'), channel('2')]);
    mockRequest
      .mockResolvedValueOnce(mockUndiciResponse(403, { message: 'Missing Access' }) as never)
      .mockResolvedValueOnce(mockUndiciResponse(200, []) as never)
      .mockResolvedValueOnce(mockUndiciResponse(200, {}) as never);

    const result = await probeClient().probe('guild-1');

    expect(result.sampledResourceId).toBe('2');
  });

  it('rejects a sampled page that is missing the fields the fetch needs', async () => {
    mockListing([channel('1')]);
    mockRequest.mockResolvedValueOnce(
      mockUndiciResponse(200, [{ id: 'm1', timestamp: '2026-08-01T00:00:00Z' }]) as never,
    );

    await expect(probeClient().probe('guild-1')).rejects.toBeInstanceOf(CommunityContractError);
  });

  it('fails when the bot holds View Channel but not Read Message History anywhere', async () => {
    mockListing([channel('1'), channel('2')], { basePermissions: '1024' });

    await expect(probeClient().probe('guild-1')).rejects.toThrow(/View Channel and Read Message History in none/);
    expect(listingCalls()).toHaveLength(4);
  });

  it('fails when Discord refuses every channel the model expected to be readable', async () => {
    mockListing([channel('1')]);
    mockRequest.mockResolvedValueOnce(mockUndiciResponse(403, { message: 'Missing Access' }) as never);

    await expect(probeClient().probe('guild-1')).rejects.toBeInstanceOf(CommunityPermissionError);
  });

  it('fails when the bot can see no supported channel', async () => {
    mockListing([]);

    await expect(probeClient().probe('guild-1')).rejects.toThrow(/no text, announcement, or forum channels/);
  });

  it('fails closed when Discord returns malformed permission data', async () => {
    mockRequest
      .mockResolvedValueOnce(mockUndiciResponse(200, { id: 'bot-1' }) as never)
      .mockResolvedValueOnce(mockUndiciResponse(200, [channel('1')]) as never)
      .mockResolvedValueOnce(mockUndiciResponse(200, { roles: 'bot-role' }) as never)
      .mockResolvedValueOnce(mockUndiciResponse(200, []) as never);

    await expect(probeClient().probe('guild-1')).rejects.toBeInstanceOf(CommunityContractError);
  });

  it('stops after ten refused channels instead of walking the whole guild', async () => {
    const channels = Array.from({ length: 25 }, (_, index) => channel(String(index + 1)));
    mockListing(channels);
    mockRequest.mockResolvedValue(mockUndiciResponse(403, { message: 'Missing Access' }) as never);

    await expect(probeClient().probe('guild-1')).rejects.toBeInstanceOf(CommunityPermissionError);
    expect(mockRequest).toHaveBeenCalledTimes(14);
  });
});
