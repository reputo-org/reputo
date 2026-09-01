import { CommunityContractError, CommunityPermissionError } from '../shared/errors.js';
import { type CommunityHttpObserver, type CommunityLogger, executeRequest } from '../shared/http.js';
import type { CommunityAdapter } from '../shared/records.js';
import type { CommunityProbeResult, CommunityResource } from '../shared/types.js';
import { createDiscordRecordIterator } from './fetch.js';
import { findExactMemberId, hasRequiredMessageFields, toCommunityResources } from './transform.js';
import {
  DISCORD_API_BASE_URL,
  type DiscordAdapterConfig,
  type DiscordRawChannel,
  type DiscordRawGuildMember,
  type DiscordRawMessage,
  type DiscordRawThread,
} from './types.js';

/** Channels the probe will try before concluding that nothing is readable. */
const PROBE_CHANNEL_LIMIT = 10;

/**
 * Members per search response. The search matches by username or nickname
 * prefix, so the page must be wide enough that the exact username match cannot
 * fall outside it. 1000 is Discord's maximum.
 */
const MEMBER_SEARCH_LIMIT = 1000;

/**
 * The Discord implementation of the community platform adapter — the read
 * side only. It needs the bot credential, never the OAuth application
 * credentials; the connect flow lives on `DiscordClient`.
 */
export function createDiscordAdapter(
  config: DiscordAdapterConfig,
  logger: CommunityLogger,
  observer?: CommunityHttpObserver,
): CommunityAdapter {
  const botHeaders = { authorization: `Bot ${config.botToken}` };
  const activeThreadsByGuild = new Map<string, Promise<DiscordRawThread[]>>();
  const iterateRecords = createDiscordRecordIterator({ config, logger, observer }, activeThreadsByGuild);

  const listRawChannels = async (guildId: string): Promise<DiscordRawChannel[]> => {
    const response = await executeRequest<DiscordRawChannel[]>(
      logger,
      config,
      {
        method: 'GET',
        url: `${DISCORD_API_BASE_URL}/guilds/${encodeURIComponent(guildId)}/channels`,
        headers: botHeaders,
      },
      observer,
    );
    return response.data ?? [];
  };

  return {
    platform: 'discord',

    async listResources(guildId: string): Promise<CommunityResource[]> {
      return toCommunityResources(await listRawChannels(guildId));
    },

    async probe(guildId: string): Promise<CommunityProbeResult> {
      const resources = toCommunityResources(await listRawChannels(guildId));

      for (const resource of resources.slice(0, PROBE_CHANNEL_LIMIT)) {
        try {
          const response = await executeRequest<DiscordRawMessage[]>(
            logger,
            config,
            {
              method: 'GET',
              url: `${DISCORD_API_BASE_URL}/channels/${encodeURIComponent(resource.id)}/messages?limit=1`,
              headers: botHeaders,
            },
            observer,
          );
          const messages = response.data ?? [];

          // The bot runs without privileged intents, so the probe proves the
          // fetch's fields arrive over REST before a snapshot depends on them.
          if (!hasRequiredMessageFields(messages)) {
            throw new CommunityContractError(
              'Discord returned messages without an id, timestamp, or author id; the fetch cannot score this server.',
            );
          }

          return {
            resourceCount: resources.length,
            sampledResourceId: resource.id,
            sampledRecordCount: messages.length,
          };
        } catch (error) {
          // A channel the bot cannot read is normal; only a guild with no
          // readable channel at all is a failed probe.
          if (error instanceof CommunityPermissionError) continue;
          throw error;
        }
      }

      throw new CommunityPermissionError(
        resources.length === 0
          ? 'The bot can see no text, announcement, or forum channels in this server.'
          : 'The bot cannot read message history in any channel of this server.',
        403,
      );
    },

    iterateRecords,

    // The member search endpoint works over REST with the bot credential and
    // no privileged intent; full member enumeration would need one.
    async searchMemberId(guildId: string, username: string): Promise<string | null> {
      const query = new URLSearchParams({ query: username, limit: String(MEMBER_SEARCH_LIMIT) });
      const response = await executeRequest<DiscordRawGuildMember[]>(
        logger,
        config,
        {
          method: 'GET',
          url: `${DISCORD_API_BASE_URL}/guilds/${encodeURIComponent(guildId)}/members/search?${query.toString()}`,
          headers: botHeaders,
        },
        observer,
      );
      return findExactMemberId(response.data ?? [], username);
    },
  };
}
