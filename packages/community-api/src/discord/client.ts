import { CommunityAuthError, CommunityHttpError, CommunityPermissionError } from '../shared/errors.js';
import { type CommunityLogger, executeRequest } from '../shared/http.js';
import type { CommunityProbeResult, CommunityResource } from '../shared/types.js';
import { buildInstallUrl, extractInstalledGuild, hasRequiredMessageFields, toCommunityResources } from './transform.js';
import {
  DISCORD_API_BASE_URL,
  type DiscordClientConfig,
  type DiscordInstalledGuild,
  type DiscordRawChannel,
  type DiscordRawMessage,
  type DiscordTokenResponse,
} from './types.js';

/** Channels the probe will try before concluding that nothing is readable. */
const PROBE_CHANNEL_LIMIT = 10;

export interface DiscordClient {
  /**
   * Authorization URL that installs the bot; `state` is minted and verified by
   * the caller. Pass `guildId` when reconnecting a known community to lock the
   * authorization screen to that server.
   */
  buildInstallUrl(state: string, guildId?: string): string;
  /** Exchanges the callback code and returns the guild the bot was installed into. */
  exchangeCode(code: string): Promise<DiscordInstalledGuild>;
  /** Text, announcement, and forum channels of a guild. */
  listResources(guildId: string): Promise<CommunityResource[]>;
  /** Lists channels and reads one page of history to verify the granted permissions. */
  probe(guildId: string): Promise<CommunityProbeResult>;
  /** Removes the bot from a guild. Idempotent: leaving a guild it is not in succeeds. */
  leaveGuild(guildId: string): Promise<void>;
}

export function createDiscordClient(config: DiscordClientConfig, logger: CommunityLogger): DiscordClient {
  const botHeaders = { authorization: `Bot ${config.botToken}` };

  const listRawChannels = async (guildId: string): Promise<DiscordRawChannel[]> => {
    const response = await executeRequest<DiscordRawChannel[]>(logger, config, {
      method: 'GET',
      url: `${DISCORD_API_BASE_URL}/guilds/${encodeURIComponent(guildId)}/channels`,
      headers: botHeaders,
    });
    return response.data ?? [];
  };

  return {
    buildInstallUrl(state, guildId) {
      return buildInstallUrl({ clientId: config.clientId, callbackUrl: config.callbackUrl, state, guildId });
    },

    async exchangeCode(code) {
      const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.callbackUrl,
      }).toString();

      try {
        const response = await executeRequest<DiscordTokenResponse>(logger, config, {
          method: 'POST',
          url: `${DISCORD_API_BASE_URL}/oauth2/token`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
        });
        return extractInstalledGuild(response.data);
      } catch (error) {
        // Discord answers an expired, replayed, or forged code with 400 invalid_grant.
        if (error instanceof CommunityHttpError && error.statusCode === 400) {
          throw new CommunityAuthError('Discord rejected the authorization code.', error.statusCode);
        }
        throw error;
      }
    },

    async listResources(guildId) {
      return toCommunityResources(await listRawChannels(guildId));
    },

    async probe(guildId) {
      const resources = toCommunityResources(await listRawChannels(guildId));

      for (const resource of resources.slice(0, PROBE_CHANNEL_LIMIT)) {
        try {
          const response = await executeRequest<DiscordRawMessage[]>(logger, config, {
            method: 'GET',
            url: `${DISCORD_API_BASE_URL}/channels/${encodeURIComponent(resource.id)}/messages?limit=1`,
            headers: botHeaders,
          });
          const messages = response.data ?? [];

          return {
            resourceCount: resources.length,
            sampledResourceId: resource.id,
            sampledRecordCount: messages.length,
            requiredFieldsPresent: hasRequiredMessageFields(messages),
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

    async leaveGuild(guildId) {
      try {
        await executeRequest(logger, config, {
          method: 'DELETE',
          url: `${DISCORD_API_BASE_URL}/users/@me/guilds/${encodeURIComponent(guildId)}`,
          headers: botHeaders,
        });
      } catch (error) {
        // The bot was already removed, so the guild is in the state we wanted.
        const goneAlready =
          error instanceof CommunityPermissionError ||
          (error instanceof CommunityHttpError && error.statusCode === 404);
        if (!goneAlready) throw error;
      }
    },
  };
}
