import { registerAs } from '@nestjs/config';
import type {
  CommunityCredentialKeyring,
  CommunityHttpConfig,
  DiscordClientConfig,
  GitHubClientConfig,
  MattermostClientConfig,
} from '@reputo/community-api';

import { env } from './env';

/** How the API follows the platforms' own live feeds. */
export interface CommunityRealtimeConfig {
  /** Window in which repeated signals for one community collapse into a single re-probe. */
  debounceMs: number;
  /**
   * Secret the GitHub App signs its deliveries with. It belongs to the feed,
   * not to the API client, which never sees it.
   */
  githubWebhookSecret: string;
}

export interface CommunityConfig {
  http: CommunityHttpConfig;
  installStateTtlSeconds: number;
  discord: DiscordClientConfig;
  github: GitHubClientConfig;
  mattermost: MattermostClientConfig;
  credentials: CommunityCredentialKeyring;
  realtime: CommunityRealtimeConfig;
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
    mattermost: {
      ...http,
      outbound: {
        allowedHosts: env.COMMUNITY_MATTERMOST_ALLOWED_HOSTS,
        maxResponseBytes: env.COMMUNITY_MATTERMOST_MAX_RESPONSE_BYTES,
      },
    },
    credentials: {
      currentSecret: env.COMMUNITY_CREDENTIALS_ENCRYPTION_KEY,
      previousSecret: env.COMMUNITY_CREDENTIALS_ENCRYPTION_KEY_PREVIOUS,
    },
    realtime: {
      debounceMs: env.COMMUNITY_REALTIME_DEBOUNCE_MS,
      githubWebhookSecret: env.GITHUB_APP_WEBHOOK_SECRET,
    },
  };
});
