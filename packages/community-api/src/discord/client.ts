import { CommunityAuthError, CommunityHttpError, CommunityPermissionError } from '../shared/errors.js';
import { type CommunityLogger, executeRequest } from '../shared/http.js';
import type { CommunityProbeResult, CommunityResource } from '../shared/types.js';
import { createDiscordAdapter } from './adapter.js';
import { buildInstallUrl, extractInstalledGuild } from './transform.js';
import {
  DISCORD_API_BASE_URL,
  type DiscordClientConfig,
  type DiscordInstalledGuild,
  type DiscordTokenResponse,
} from './types.js';

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
  // The read side is the adapter; the client adds the connect-flow calls that
  // need the OAuth application credentials.
  const adapter = createDiscordAdapter(config, logger);

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
      return adapter.listResources(guildId);
    },

    async probe(guildId) {
      return adapter.probe(guildId);
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
