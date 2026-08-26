import { describe, expect, it } from 'vitest';
import {
  buildInstallUrl,
  extractInstalledGuild,
  hasRequiredMessageFields,
  toCommunityResources,
} from '../../../src/discord/transform.js';
import { DISCORD_BOT_PERMISSIONS } from '../../../src/discord/types.js';
import { CommunityContractError } from '../../../src/shared/errors.js';
import { TEST_DISCORD_CONFIG } from '../../utils/mock-helpers.js';

describe('buildInstallUrl', () => {
  const url = new URL(
    buildInstallUrl({
      clientId: TEST_DISCORD_CONFIG.clientId,
      callbackUrl: TEST_DISCORD_CONFIG.callbackUrl,
      state: 'signed-state',
    }),
  );

  it('targets the Discord bot authorization endpoint', () => {
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
  });

  it('requests the bot scope with an authorization code', () => {
    expect(url.searchParams.get('scope')).toBe('bot');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('asks for View Channels and Read Message History only', () => {
    expect(DISCORD_BOT_PERMISSIONS).toBe('66560');
    expect(url.searchParams.get('permissions')).toBe('66560');
  });

  it('carries the caller-minted state and callback URL', () => {
    expect(url.searchParams.get('state')).toBe('signed-state');
    expect(url.searchParams.get('redirect_uri')).toBe(TEST_DISCORD_CONFIG.callbackUrl);
  });

  it('never carries the client secret', () => {
    expect(url.toString()).not.toContain(TEST_DISCORD_CONFIG.clientSecret);
  });

  it('leaves the guild picker open when no guild is given', () => {
    expect(url.searchParams.has('guild_id')).toBe(false);
    expect(url.searchParams.has('disable_guild_select')).toBe(false);
  });

  it('locks the picker to one guild when reconnecting a known community', () => {
    const reconnect = new URL(
      buildInstallUrl({
        clientId: TEST_DISCORD_CONFIG.clientId,
        callbackUrl: TEST_DISCORD_CONFIG.callbackUrl,
        state: 'signed-state',
        guildId: '974492421130127923',
      }),
    );

    expect(reconnect.searchParams.get('guild_id')).toBe('974492421130127923');
    expect(reconnect.searchParams.get('disable_guild_select')).toBe('true');
  });
});

describe('extractInstalledGuild', () => {
  it('returns the installed guild', () => {
    expect(extractInstalledGuild({ guild: { id: '9', name: 'SingularityNET' } })).toEqual({
      id: '9',
      name: 'SingularityNET',
    });
  });

  it('falls back to the id when the guild has no usable name', () => {
    expect(extractInstalledGuild({ guild: { id: '9', name: '' } })).toEqual({ id: '9', name: '9' });
    expect(extractInstalledGuild({ guild: { id: '9' } })).toEqual({ id: '9', name: '9' });
  });

  it('rejects a token response without a guild', () => {
    expect(() => extractInstalledGuild({})).toThrow(CommunityContractError);
    expect(() => extractInstalledGuild({ guild: { id: 42 } })).toThrow(CommunityContractError);
  });
});

describe('toCommunityResources', () => {
  it('keeps text, announcement, and forum channels', () => {
    const resources = toCommunityResources([
      { id: '1', name: 'general', type: 0, position: 0 },
      { id: '2', name: 'news', type: 5, position: 1 },
      { id: '3', name: 'help', type: 15, position: 2 },
    ]);

    expect(resources).toEqual([
      { id: '1', name: 'general', kind: 'text' },
      { id: '2', name: 'news', kind: 'announcement' },
      { id: '3', name: 'help', kind: 'forum' },
    ]);
  });

  it('drops voice, category, and other unsupported channel types', () => {
    const resources = toCommunityResources([
      { id: '1', name: 'voice', type: 2 },
      { id: '2', name: 'category', type: 4 },
      { id: '3', name: 'stage', type: 13 },
      { id: '4', name: 'media', type: 16 },
      { id: '5', name: 'general', type: 0 },
    ]);

    expect(resources.map((resource) => resource.id)).toEqual(['5']);
  });

  it('drops malformed rows instead of failing the listing', () => {
    const resources = toCommunityResources([
      { id: 7, name: 'numeric id', type: 0 },
      { name: 'no id', type: 0 },
      { id: '2', name: 'no type' },
      { id: '3', name: 'good', type: 0 },
    ]);

    expect(resources).toEqual([{ id: '3', name: 'good', kind: 'text' }]);
  });

  it('orders by guild position, then by id, and names unnamed channels by id', () => {
    const resources = toCommunityResources([
      { id: 'b', type: 0, position: 5 },
      { id: 'a', name: 'first', type: 0, position: 1 },
      { id: 'c', name: 'unpositioned', type: 0 },
    ]);

    expect(resources).toEqual([
      { id: 'a', name: 'first', kind: 'text' },
      { id: 'b', name: 'b', kind: 'text' },
      { id: 'c', name: 'unpositioned', kind: 'text' },
    ]);
  });

  it('rejects a listing that is not an array', () => {
    expect(() => toCommunityResources({ message: 'Missing Access' } as never)).toThrow(CommunityContractError);
  });
});

describe('hasRequiredMessageFields', () => {
  const message = { id: '1', timestamp: '2026-08-01T00:00:00.000+00:00', author: { id: '42' } };

  it('accepts a message carrying id, timestamp, and author id', () => {
    expect(hasRequiredMessageFields([message])).toBe(true);
  });

  it('treats an empty page as verified — read permission was still proven', () => {
    expect(hasRequiredMessageFields([])).toBe(true);
  });

  it('rejects a page missing any field the fetch depends on', () => {
    expect(hasRequiredMessageFields([{ ...message, author: {} }])).toBe(false);
    expect(hasRequiredMessageFields([{ ...message, timestamp: undefined }])).toBe(false);
    expect(hasRequiredMessageFields([{ ...message, id: undefined }])).toBe(false);
  });
});
