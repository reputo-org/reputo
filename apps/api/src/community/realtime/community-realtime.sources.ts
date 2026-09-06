import type { ConfigService } from '@nestjs/config';
import {
  type CommunityRealtimeSource,
  createDiscordGateway,
  createMattermostSocket,
  type DiscordAdapterConfig,
  type MattermostClientConfig,
  type MattermostSocketTarget,
} from '@reputo/community-api';
import type { PinoLogger } from 'nestjs-pino';

/** Injection token for the factory that builds the platform feeds. */
export const COMMUNITY_REALTIME_SOURCES = 'COMMUNITY_REALTIME_SOURCES';

/**
 * Builds the platform feeds the supervisor manages. It exists as its own
 * provider so the supervisor can be exercised — its reconciliation, its signal
 * handling, its status — against feeds that are driven by hand instead of by a
 * socket to a real platform.
 */
export interface CommunityRealtimeSourceFactory {
  /** One Gateway socket for the whole bot, covering every connected guild. */
  discord(): CommunityRealtimeSource;
  /** One socket per connected Mattermost team, because the credential is per connection. */
  mattermost(target: MattermostSocketTarget): CommunityRealtimeSource;
}

export function createCommunityRealtimeSources(
  configService: ConfigService,
  logger: PinoLogger,
): CommunityRealtimeSourceFactory {
  const discordConfig = configService.get<DiscordAdapterConfig>('community.discord') as DiscordAdapterConfig;
  const mattermostConfig = configService.get<MattermostClientConfig>('community.mattermost') as MattermostClientConfig;

  return {
    discord: () => createDiscordGateway(discordConfig, logger),
    mattermost: (target) => createMattermostSocket(mattermostConfig, target, logger),
  };
}
