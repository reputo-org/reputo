import { registerAs } from '@nestjs/config';
import type { CommunityHttpConfig, DiscordClientConfig, GitHubClientConfig } from '@reputo/community-api';

import { env } from './env';

export interface CommunityConfig {
  http: CommunityHttpConfig;
  installStateTtlSeconds: number;
  discord: DiscordClientConfig;
  github: GitHubClientConfig;
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
    github: {
      ...http,
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
      slug: env.GITHUB_APP_SLUG,
      callbackUrl: env.GITHUB_APP_CALLBACK_URL,
    },
  };
});
