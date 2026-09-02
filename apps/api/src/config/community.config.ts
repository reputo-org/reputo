import { registerAs } from '@nestjs/config';
import type {
  CommunityCredentialKeyring,
  CommunityHttpConfig,
  DiscordClientConfig,
  GitHubClientConfig,
  MattermostClientConfig,
} from '@reputo/community-api';

import { env } from './env';

export interface CommunityHealthSweepConfig {
  /** Milliseconds between sweep passes; 0 disables the sweep. */
  intervalMs: number;
  /** Age after which an active connection is re-probed. */
  activeRecheckAfterMs: number;
  /** Age after which a pending, degraded, or broken connection is re-probed. */
  failedRecheckAfterMs: number;
  /** Pause between consecutive probes within one pass. */
  probeSpacingMs: number;
}

export interface CommunityConfig {
  http: CommunityHttpConfig;
  installStateTtlSeconds: number;
  discord: DiscordClientConfig;
  github: GitHubClientConfig;
  mattermost: MattermostClientConfig;
  credentials: CommunityCredentialKeyring;
  healthSweep: CommunityHealthSweepConfig;
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
    healthSweep: {
      intervalMs: env.COMMUNITY_HEALTH_SWEEP_INTERVAL_MS,
      activeRecheckAfterMs: env.COMMUNITY_HEALTH_ACTIVE_RECHECK_AFTER_MS,
      failedRecheckAfterMs: env.COMMUNITY_HEALTH_FAILED_RECHECK_AFTER_MS,
      probeSpacingMs: env.COMMUNITY_HEALTH_PROBE_SPACING_MS,
    },
  };
});
