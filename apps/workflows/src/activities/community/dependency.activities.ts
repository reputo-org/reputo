import {
  type CommunityAdapter,
  CommunityApiError,
  type CommunityHttpObserver,
  type CommunityLogger,
  createDiscordAdapter,
  createGitHubAdapter,
  type GitHubRateLimit,
} from '@reputo/community-api';
import { CommunityPlatform } from '@reputo/contracts';
import { createDeepIdClient } from '@reputo/deep-id-api';
import { Context } from '@temporalio/activity';
import config from '../../config/index.js';
import type {
  CommunityDependencyKey,
  CommunityDependencyResolverContext,
  DependencyResolverActivities,
  ResolveDependencyInput,
  ResolveDependencyResult,
} from '../../shared/types/index.js';
import { COMMUNITY_PLATFORM_BY_DEPENDENCY_KEY } from '../../shared/types/index.js';
import { buildCommunityCohort } from './cohort.js';
import { type CommunityFetchCheckpoint, type CommunityRequestStats, freezeCommunityDataset } from './dataset-engine.js';

/**
 * Platform errors carry a response-body snippet in their message. Temporal
 * serializes an activity failure into workflow history and the orchestrator
 * persists it on the snapshot, so a platform failure crosses this boundary as
 * its safe category only — never a body, and never chained as a `cause`.
 */
function toSafeFailure(platform: CommunityPlatform, error: unknown): unknown {
  return error instanceof CommunityApiError
    ? new Error(`Community ${platform} fetch failed: ${error.category}`)
    : error;
}

/**
 * The adapter each platform's fetch runs on, built from deployment credentials
 * only. `rateLimit` is optional: platforms that report a budget expose it, and
 * the run logs its request count against it.
 */
function createPlatformAdapter(
  platform: CommunityPlatform,
  communityId: string,
  logger: CommunityLogger,
  observer: CommunityHttpObserver,
): CommunityAdapter & { rateLimit?(): GitHubRateLimit | undefined } {
  const http = {
    requestTimeoutMs: config.community.requestTimeoutMs,
    retry: {
      maxAttempts: config.community.retryMaxAttempts,
      baseDelayMs: config.community.retryBaseDelayMs,
      maxDelayMs: config.community.retryMaxDelayMs,
    },
  };

  switch (platform) {
    case CommunityPlatform.discord:
      return createDiscordAdapter({ ...http, botToken: config.community.discordBotToken }, logger, observer);
    case CommunityPlatform.github:
      // The crawl carries no community id per resource, so the installation is
      // bound here — one adapter per fetch.
      return createGitHubAdapter(
        {
          ...http,
          appId: config.community.githubAppId,
          privateKey: config.community.githubAppPrivateKey,
          installationId: communityId,
        },
        logger,
        observer,
      );
    default:
      throw new Error(`community worker has no adapter for platform "${platform}"`);
  }
}

export function createCommunityDependencyResolverActivities(
  ctx: CommunityDependencyResolverContext,
): DependencyResolverActivities {
  return {
    async resolveDependency(input: ResolveDependencyInput): Promise<ResolveDependencyResult> {
      const { dependencyKey, snapshotId, communityFetch } = input;
      const platform: CommunityPlatform | undefined =
        COMMUNITY_PLATFORM_BY_DEPENDENCY_KEY[dependencyKey as CommunityDependencyKey];
      if (platform === undefined) {
        throw new Error(
          `community worker received unexpected dependency "${dependencyKey}"; supported: ${Object.keys(COMMUNITY_PLATFORM_BY_DEPENDENCY_KEY).join(', ')}`,
        );
      }
      if (communityFetch === undefined) {
        throw new Error(`community dependency "${dependencyKey}" requires the orchestrator's communityFetch input`);
      }
      if (typeof communityFetch.communityId !== 'string' || communityFetch.communityId.trim() === '') {
        throw new Error(`community dependency "${dependencyKey}" requires the connection's platform community id`);
      }

      const context = Context.current();
      const logger = context.log;
      const communityLogger: CommunityLogger = {
        debug: (payload) => logger.debug('community-api', payload as Record<string, unknown>),
        warn: (payload) => logger.warn('community-api', payload as Record<string, unknown>),
      };
      const requestStats: CommunityRequestStats = { requests: 0, rateLimitWaits: 0, rateLimitWaitMs: 0 };
      const adapter = createPlatformAdapter(platform, communityFetch.communityId, communityLogger, {
        onRequest: () => {
          requestStats.requests += 1;
        },
        onRateLimitWait: (delayMs) => {
          requestStats.rateLimitWaits += 1;
          requestStats.rateLimitWaitMs += delayMs;
        },
      });

      logger.info('Resolving community dependency', {
        dependencyKey,
        snapshotId,
        platform,
        resourceCount: communityFetch.resourceIds.length,
        windowStart: communityFetch.windowStart,
        windowEnd: communityFetch.windowEnd,
      });

      const deepId = createDeepIdClient({
        identityBaseUrl: config.deepId.identityBaseUrl,
        appBaseUrl: config.deepId.appBaseUrl,
        clientId: config.deepId.clientId,
        clientSecret: config.deepId.clientSecret,
        scopes: config.deepId.scopes,
        requestTimeoutMs: config.deepId.requestTimeoutMs,
        concurrency: config.deepId.concurrency,
        defaultPageSize: config.deepId.usersPageSize,
        retry: {
          maxAttempts: config.deepId.retryMaxAttempts,
          baseDelayMs: config.deepId.retryBaseDelayMs,
          maxDelayMs: config.deepId.retryMaxDelayMs,
        },
        logLevel: config.logger.level,
      });

      let result: Awaited<ReturnType<typeof freezeCommunityDataset>>;
      try {
        result = await freezeCommunityDataset({
          snapshotId,
          platform,
          window: { start: communityFetch.windowStart, end: communityFetch.windowEnd },
          resourceIds: communityFetch.resourceIds,
          adapter,
          storage: ctx.storage,
          bucket: ctx.storageConfig.bucket,
          fetchCohort: (heartbeat) =>
            buildCommunityCohort({
              platform,
              communityId: communityFetch.communityId,
              adapter,
              deepId,
              heartbeat,
              logger,
            }),
          requestStats,
          progress: {
            heartbeat: (checkpoint) => context.heartbeat(checkpoint),
            lastCheckpoint: context.info.heartbeatDetails as CommunityFetchCheckpoint | undefined,
          },
          logger,
        });
      } catch (error) {
        throw toSafeFailure(platform, error);
      }

      logger.info('Community dependency resolved', {
        dependencyKey,
        snapshotId,
        committed: result.committed,
        fetchStats: result.manifest.fetchStats,
        // Reads the run's request count against the platform's hourly budget.
        rateLimit: adapter.rateLimit?.(),
      });

      return {};
    },
  };
}
