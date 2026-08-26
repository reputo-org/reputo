import { request } from 'undici';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiscordClient } from '../../../src/discord/client.js';
import { CommunityAuthError, CommunityPermissionError } from '../../../src/shared/errors.js';
import { createStubLogger, mockUndiciResponse, TEST_DISCORD_CONFIG } from '../../utils/mock-helpers.js';

vi.mock('undici', () => ({ request: vi.fn() }));

const mockRequest = vi.mocked(request);
const client = createDiscordClient(TEST_DISCORD_CONFIG, createStubLogger());

const channel = (id: string, type = 0) => ({ id, name: `channel-${id}`, type, position: Number(id) });
const message = { id: 'm1', timestamp: '2026-08-01T00:00:00.000+00:00', author: { id: '42' } };

const lastCall = () => mockRequest.mock.calls.at(-1) as [string, { headers?: Record<string, string>; body?: string }];

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

  it('reads the guild channels with the bot credential', async () => {
    mockRequest.mockResolvedValue(mockUndiciResponse(200, [channel('1'), channel('2', 15)]) as never);

    const resources = await client.listResources('guild-1');

    expect(resources).toEqual([
      { id: '1', name: 'channel-1', kind: 'text' },
      { id: '2', name: 'channel-2', kind: 'forum' },
    ]);

    const [url, options] = lastCall();
    expect(url).toBe('https://discord.com/api/v10/guilds/guild-1/channels');
    expect(options.headers?.authorization).toBe(`Bot ${TEST_DISCORD_CONFIG.botToken}`);
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

  it('reads a single page of history from the first readable channel', async () => {
    mockRequest
      .mockResolvedValueOnce(mockUndiciResponse(200, [channel('1'), channel('2')]) as never)
      .mockResolvedValueOnce(mockUndiciResponse(200, [message]) as never);

    const result = await client.probe('guild-1');

    expect(result).toEqual({
      resourceCount: 2,
      sampledResourceId: '1',
      sampledRecordCount: 1,
      requiredFieldsPresent: true,
    });
    expect(lastCall()[0]).toBe('https://discord.com/api/v10/channels/1/messages?limit=1');
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('skips channels the bot cannot read and samples the next one', async () => {
    mockRequest
      .mockResolvedValueOnce(mockUndiciResponse(200, [channel('1'), channel('2')]) as never)
      .mockResolvedValueOnce(mockUndiciResponse(403, { message: 'Missing Access' }) as never)
      .mockResolvedValueOnce(mockUndiciResponse(200, []) as never);

    const result = await client.probe('guild-1');

    expect(result.sampledResourceId).toBe('2');
    expect(result.sampledRecordCount).toBe(0);
    expect(result.requiredFieldsPresent).toBe(true);
  });

  it('flags a sampled page that is missing the fields the fetch needs', async () => {
    mockRequest
      .mockResolvedValueOnce(mockUndiciResponse(200, [channel('1')]) as never)
      .mockResolvedValueOnce(mockUndiciResponse(200, [{ id: 'm1', timestamp: '2026-08-01T00:00:00Z' }]) as never);

    const result = await client.probe('guild-1');

    expect(result.requiredFieldsPresent).toBe(false);
  });

  it('fails when no channel in the guild is readable', async () => {
    mockRequest
      .mockResolvedValueOnce(mockUndiciResponse(200, [channel('1')]) as never)
      .mockResolvedValueOnce(mockUndiciResponse(403, { message: 'Missing Access' }) as never);

    await expect(client.probe('guild-1')).rejects.toBeInstanceOf(CommunityPermissionError);
  });

  it('fails when the bot can see no supported channel', async () => {
    mockRequest.mockResolvedValueOnce(mockUndiciResponse(200, []) as never);

    await expect(client.probe('guild-1')).rejects.toThrow(/no text, announcement, or forum channels/);
  });

  it('stops after ten unreadable channels instead of walking the whole guild', async () => {
    const channels = Array.from({ length: 25 }, (_, index) => channel(String(index + 1)));
    mockRequest.mockResolvedValueOnce(mockUndiciResponse(200, channels) as never);
    mockRequest.mockResolvedValue(mockUndiciResponse(403, { message: 'Missing Access' }) as never);

    await expect(client.probe('guild-1')).rejects.toBeInstanceOf(CommunityPermissionError);
    expect(mockRequest).toHaveBeenCalledTimes(11);
  });
});
