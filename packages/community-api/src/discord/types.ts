import type { CommunityHttpConfig } from '../shared/types.js';

export const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
export const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';

/**
 * View Channels (1 << 10) and Read Message History (1 << 16) — the only two
 * permissions the bot asks for. Anything wider would let it act in the guild.
 */
export const DISCORD_BOT_PERMISSIONS = String((1 << 10) | (1 << 16));

/** Channel types the community pipeline reads. Threads are enumerated per channel at fetch time. */
export const DiscordChannelType = {
  guildText: 0,
  guildAnnouncement: 5,
  guildForum: 15,
} as const;

export interface DiscordClientConfig extends CommunityHttpConfig {
  clientId: string;
  clientSecret: string;
  /** Deployment credential used for every guild read. Never persisted, never logged. */
  botToken: string;
  /** Absolute URL Discord redirects the browser back to after the bot install. */
  callbackUrl: string;
}

export interface DiscordInstalledGuild {
  id: string;
  name: string;
}

/** Raw shapes, narrowed before use — the transforms own the validation. */
export interface DiscordTokenResponse {
  guild?: { id?: unknown; name?: unknown };
}

export interface DiscordRawChannel {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  position?: unknown;
}

export interface DiscordRawMessage {
  id?: unknown;
  timestamp?: unknown;
  author?: { id?: unknown };
}
