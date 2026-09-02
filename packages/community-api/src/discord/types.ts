import type { CommunityHttpConfig } from '../shared/types.js';

export const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
export const DISCORD_AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
export const DISCORD_CDN_BASE_URL = 'https://cdn.discordapp.com';

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

/** Thread channel types. Private threads are out of scope for the crawl. */
export const DiscordThreadType = {
  announcementThread: 10,
  publicThread: 11,
  privateThread: 12,
} as const;

/** Message types the crawl scores. Everything else (joins, pins, system rows) is skipped. */
export const DiscordMessageType = {
  default: 0,
  reply: 19,
} as const;

/**
 * What the read side (adapter) needs: the bot credential and transport
 * settings. The OAuth application credentials belong to the connect flow only.
 */
export interface DiscordAdapterConfig extends CommunityHttpConfig {
  /** Deployment credential used for every guild read. Never persisted, never logged. */
  botToken: string;
}

export interface DiscordClientConfig extends DiscordAdapterConfig {
  clientId: string;
  clientSecret: string;
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

export interface DiscordRawGuild {
  icon?: unknown;
  approximate_member_count?: unknown;
}

export interface DiscordRawChannel {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  position?: unknown;
  guild_id?: unknown;
  permission_overwrites?: unknown;
}

export interface DiscordRawMessage {
  id?: unknown;
  type?: unknown;
  timestamp?: unknown;
  author?: { id?: unknown; bot?: unknown };
  mentions?: unknown;
  reactions?: unknown;
  referenced_message?: {
    id?: unknown;
    timestamp?: unknown;
    author?: { id?: unknown; bot?: unknown };
  } | null;
}

export interface DiscordRawGuildMember {
  user?: { id?: unknown; username?: unknown };
  roles?: unknown;
}

export interface DiscordRawUser {
  id?: unknown;
}

export interface DiscordRawRole {
  id?: unknown;
  permissions?: unknown;
}

export interface DiscordRawPermissionOverwrite {
  id?: unknown;
  type?: unknown;
  allow?: unknown;
  deny?: unknown;
}

export interface DiscordRawThread {
  id?: unknown;
  type?: unknown;
  parent_id?: unknown;
  thread_metadata?: { archive_timestamp?: unknown };
}

export interface DiscordRawActiveThreadsResponse {
  threads?: unknown;
}

export interface DiscordRawArchivedThreadsResponse {
  threads?: unknown;
  has_more?: unknown;
}
