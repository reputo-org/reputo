import { CommunityContractError } from '../shared/errors.js';
import type { CommunityResource, CommunityResourceKind } from '../shared/types.js';
import {
  DISCORD_AUTHORIZE_URL,
  DISCORD_BOT_PERMISSIONS,
  DiscordChannelType,
  type DiscordInstalledGuild,
  type DiscordRawChannel,
  type DiscordRawMessage,
  type DiscordTokenResponse,
} from './types.js';

export interface BuildInstallUrlParams {
  clientId: string;
  callbackUrl: string;
  /** Signed, TTL-bounded value the caller mints and verifies on the callback. */
  state: string;
  /**
   * Guild to pre-select on the authorization screen. Set when reconnecting an
   * existing community so the admin cannot land on the wrong server; the guild
   * picker is locked to it.
   */
  guildId?: string;
}

const CHANNEL_KIND_BY_TYPE = new Map<number, CommunityResourceKind>([
  [DiscordChannelType.guildText, 'text'],
  [DiscordChannelType.guildAnnouncement, 'announcement'],
  [DiscordChannelType.guildForum, 'forum'],
]);

/**
 * Bot-install authorization URL. `scope=bot` with exactly the read permissions
 * the pipeline needs, and `response_type=code` so the callback can exchange the
 * code and learn which guild was installed.
 */
export function buildInstallUrl({ clientId, callbackUrl, state, guildId }: BuildInstallUrlParams): string {
  const url = new URL(DISCORD_AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('scope', 'bot');
  url.searchParams.set('permissions', DISCORD_BOT_PERMISSIONS);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('state', state);

  if (guildId) {
    url.searchParams.set('guild_id', guildId);
    url.searchParams.set('disable_guild_select', 'true');
  }

  return url.toString();
}

/** The guild a bot-scoped token exchange installed into. */
export function extractInstalledGuild(response: DiscordTokenResponse): DiscordInstalledGuild {
  const id = response?.guild?.id;
  const name = response?.guild?.name;

  if (typeof id !== 'string' || id.length === 0) {
    throw new CommunityContractError('Discord token response carried no guild id; the bot scope was not granted.');
  }

  return { id, name: typeof name === 'string' && name.length > 0 ? name : id };
}

/** Channels the pipeline can read, in the order Discord shows them. */
export function toCommunityResources(channels: readonly DiscordRawChannel[]): CommunityResource[] {
  if (!Array.isArray(channels)) {
    throw new CommunityContractError('Discord channel listing was not an array.');
  }

  return channels
    .filter(
      (channel): channel is DiscordRawChannel & { id: string; type: number } =>
        typeof channel?.id === 'string' && typeof channel.type === 'number' && CHANNEL_KIND_BY_TYPE.has(channel.type),
    )
    .sort((a, b) => {
      const positionA = typeof a.position === 'number' ? a.position : Number.MAX_SAFE_INTEGER;
      const positionB = typeof b.position === 'number' ? b.position : Number.MAX_SAFE_INTEGER;
      return positionA === positionB ? a.id.localeCompare(b.id) : positionA - positionB;
    })
    .map((channel) => ({
      id: channel.id,
      name: typeof channel.name === 'string' && channel.name.length > 0 ? channel.name : channel.id,
      kind: CHANNEL_KIND_BY_TYPE.get(channel.type) as CommunityResourceKind,
    }));
}

/**
 * Whether a sampled page carries the fields the fetch depends on. The bot runs
 * without privileged intents, so the probe proves these arrive over REST before
 * a snapshot ever relies on them. An empty page proves read permission and
 * leaves the fields unverified, which counts as present.
 */
export function hasRequiredMessageFields(messages: readonly DiscordRawMessage[]): boolean {
  return messages.every(
    (message) =>
      typeof message?.id === 'string' &&
      typeof message.timestamp === 'string' &&
      typeof message.author?.id === 'string',
  );
}
