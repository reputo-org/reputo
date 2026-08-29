import { registerAs } from '@nestjs/config';
import type { CommunityHttpConfig, DiscordClientConfig } from '@reputo/community-api';

import { env } from './env';

export interface CommunityConfig {
  http: CommunityHttpConfig;
  installStateTtlSeconds: number;
  discord: DiscordClientConfig;
}

export default registerAs('community', (): CommunityConfig => {
  const http: CommunityHttpConfig = {
    requestTimeoutMs: env.COMMUNITY_API_REQUEST_TIMEOUT_MS,
    retry: {
      maxAttempts: env.COMMUNITY_API_RETRY_MAX_ATTEMPTS,
      baseDelayMs: env.COMMUNITY_API_RETRY_BASE_DELAY_MS,
      maxDelayMs: env.COMMUNITY_API_RETRY_MAX_DELAY_MS,
    },
  };

  return {
    http,
    installStateTtlSeconds: env.COMMUNITY_INSTALL_STATE_TTL_SECONDS,
    discord: {
      ...http,
      clientId: env.DISCORD_CLIENT_ID,
      clientSecret: env.DISCORD_CLIENT_SECRET,
      botToken: env.DISCORD_BOT_TOKEN,
      callbackUrl: env.DISCORD_BOT_CALLBACK_URL,
    },
  };
});
