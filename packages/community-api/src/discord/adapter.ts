import { CommunityContractError, CommunityPermissionError } from '../shared/errors.js';
import { type CommunityHttpObserver, type CommunityLogger, executeRequest } from '../shared/http.js';
import type { CommunityAdapter } from '../shared/records.js';
import {
  type CommunityProbeResult,
  type CommunityProfile,
  type CommunityResource,
  digestCommunityResources,
} from '../shared/types.js';
import { createDiscordRecordIterator } from './fetch.js';
import {
  findExactMemberId,
  hasRequiredMessageFields,
  toCommunityResources,
  toDiscordGuildProfile,
  toDiscordPermissionContext,
} from './transform.js';
import {
  DISCORD_API_BASE_URL,
  type DiscordAdapterConfig,
  type DiscordRawChannel,
  type DiscordRawGuild,
  type DiscordRawGuildMember,
  type DiscordRawMessage,
  type DiscordRawRole,
  type DiscordRawThread,
  type DiscordRawUser,
} from './types.js';

/** Readable channels the probe will try before concluding that nothing is readable. */
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

  const get = async <T>(path: string): Promise<T> => {
    const response = await executeRequest<T>(
      logger,
      config,
      { method: 'GET', url: `${DISCORD_API_BASE_URL}${path}`, headers: botHeaders },
      observer,
    );
    return response.data;
  };

  // The bot's own id never changes for a token; one lookup serves every guild
  // this adapter reads. A failed lookup is evicted so the next call retries.
  let botUserId: Promise<string> | undefined;
  const fetchBotUserId = (): Promise<string> => {
    if (!botUserId) {
      const pending = get<DiscordRawUser>('/users/@me').then((user) => {
        if (typeof user?.id !== 'string' || user.id.length === 0) {
          throw new CommunityContractError('Discord returned no bot user id for the permission check.');
        }
        return user.id;
      });
      pending.catch(() => {
        botUserId = undefined;
      });
      botUserId = pending;
    }
    return botUserId;
  };

  // Best-effort display facts; a failure here never fails the probe.
  const fetchGuildProfile = async (guildId: string): Promise<CommunityProfile | undefined> => {
    try {
      const guild = await get<DiscordRawGuild>(`/guilds/${encodeURIComponent(guildId)}?with_counts=true`);
      return toDiscordGuildProfile(guildId, guild ?? {});
    } catch {
      logger.warn({ platform: 'discord', message: 'Guild profile lookup failed; probe continues without it.' });
      return undefined;
    }
  };

  /**
   * Every readable-kind channel of the guild with the bot's effective access
   * resolved from the guild roles and the channel overwrites. Discord lists
   * channels the bot cannot see, so the listing alone would offer private
   * channels as if they were readable.
   */
  const listChannels = async (guildId: string): Promise<CommunityResource[]> => {
    const botId = await fetchBotUserId();
    const guildPath = `/guilds/${encodeURIComponent(guildId)}`;
    const [channels, member, roles] = await Promise.all([
      get<DiscordRawChannel[]>(`${guildPath}/channels`),
      get<DiscordRawGuildMember>(`${guildPath}/members/${encodeURIComponent(botId)}`),
      get<DiscordRawRole[]>(`${guildPath}/roles`),
    ]);
    return toCommunityResources(channels ?? [], toDiscordPermissionContext(guildId, botId, member ?? {}, roles ?? []));
  };

  return {
    platform: 'discord',

    listResources: listChannels,

    async probe(guildId: string): Promise<CommunityProbeResult> {
      const resources = await listChannels(guildId);
      const readable = resources.filter((resource) => resource.readable);

      for (const resource of readable.slice(0, PROBE_CHANNEL_LIMIT)) {
        try {
          const messages =
            (await get<DiscordRawMessage[]>(`/channels/${encodeURIComponent(resource.id)}/messages?limit=1`)) ?? [];

          // The bot runs without privileged intents, so the probe proves the
          // fetch's fields arrive over REST before a snapshot depends on them.
          if (!hasRequiredMessageFields(messages)) {
            throw new CommunityContractError(
              'Discord returned messages without an id, timestamp, or author id; the fetch cannot score this server.',
            );
          }

          return {
            resourceCount: resources.length,
            readableResourceCount: readable.length,
            resourcesDigest: digestCommunityResources(resources),
            sampledResourceId: resource.id,
            sampledRecordCount: messages.length,
            profile: await fetchGuildProfile(guildId),
          };
        } catch (error) {
          // Discord can lag a permission change by a moment; a channel the
          // resolver expected to be readable but the API refuses is skipped.
          if (error instanceof CommunityPermissionError) continue;
          throw error;
        }
      }

      throw new CommunityPermissionError(
        resources.length === 0
          ? 'The bot can see no text, announcement, or forum channels in this server.'
          : readable.length === 0
            ? `The bot has View Channel and Read Message History in none of the ${resources.length} channels of this server.`
            : 'The bot cannot read message history in any channel of this server.',
        403,
      );
    },

    iterateRecords,

    // The member search endpoint works over REST with the bot credential and
    // no privileged intent; full member enumeration would need one.
    async searchMemberId(guildId: string, username: string): Promise<string | null> {
      const query = new URLSearchParams({ query: username, limit: String(MEMBER_SEARCH_LIMIT) });
      const members = await get<DiscordRawGuildMember[]>(
        `/guilds/${encodeURIComponent(guildId)}/members/search?${query.toString()}`,
      );
      return findExactMemberId(members ?? [], username);
    },
  };
}
