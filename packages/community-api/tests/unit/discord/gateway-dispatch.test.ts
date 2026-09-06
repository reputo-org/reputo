import { describe, expect, it } from 'vitest';
import { readDiscordDispatch } from '../../../src/discord/transform.js';

const GUILD = '974492421130127923';
const CHANNEL = '1000000000000000001';

describe('readDiscordDispatch', () => {
  it('reads a guild becoming available, so the caller can tell a join from a session replay', () => {
    expect(readDiscordDispatch('GUILD_CREATE', { id: GUILD })).toEqual({ type: 'available', guildId: GUILD });
  });

  it('reads the bot losing a guild as revoked access', () => {
    expect(readDiscordDispatch('GUILD_DELETE', { id: GUILD })).toEqual({
      type: 'changed',
      guildId: GUILD,
      kind: 'revoked',
    });
  });

  it('reads a Discord outage as an outage, not as the bot being kicked', () => {
    expect(readDiscordDispatch('GUILD_DELETE', { id: GUILD, unavailable: true })).toEqual({
      type: 'outage',
      guildId: GUILD,
    });
  });

  it('reads a guild rename as a community change', () => {
    expect(readDiscordDispatch('GUILD_UPDATE', { id: GUILD, name: 'SNET' })).toEqual({
      type: 'changed',
      guildId: GUILD,
      kind: 'community',
    });
  });

  it.each([
    'CHANNEL_CREATE',
    'CHANNEL_UPDATE',
    'CHANNEL_DELETE',
  ])('reads %s as a resource change on the channel’s guild', (event) => {
    expect(readDiscordDispatch(event, { id: CHANNEL, guild_id: GUILD, type: 0 })).toEqual({
      type: 'changed',
      guildId: GUILD,
      kind: 'resources',
    });
  });

  it.each([
    'GUILD_ROLE_CREATE',
    'GUILD_ROLE_UPDATE',
    'GUILD_ROLE_DELETE',
  ])('reads %s as a resource change, because a role decides effective channel access', (event) => {
    expect(readDiscordDispatch(event, { guild_id: GUILD, role: { id: 'r1' } })).toEqual({
      type: 'changed',
      guildId: GUILD,
      kind: 'resources',
    });
  });

  it('never signals a channel id as a community id', () => {
    // A DM channel dispatch carries no guild_id but does carry its own id.
    expect(readDiscordDispatch('CHANNEL_UPDATE', { id: CHANNEL, type: 1 })).toEqual({ type: 'ignored' });
  });

  it('ignores dispatches that say nothing about read access', () => {
    expect(readDiscordDispatch('MESSAGE_CREATE', { id: 'm1', guild_id: GUILD })).toEqual({ type: 'ignored' });
    expect(readDiscordDispatch('TYPING_START', { guild_id: GUILD })).toEqual({ type: 'ignored' });
    expect(readDiscordDispatch('PRESENCE_UPDATE', { guild_id: GUILD })).toEqual({ type: 'ignored' });
  });

  it('ignores a dispatch with no usable id', () => {
    expect(readDiscordDispatch('GUILD_UPDATE', {})).toEqual({ type: 'ignored' });
    expect(readDiscordDispatch('CHANNEL_CREATE', { guild_id: '' })).toEqual({ type: 'ignored' });
    expect(readDiscordDispatch('GUILD_CREATE', undefined)).toEqual({ type: 'ignored' });
  });
});
