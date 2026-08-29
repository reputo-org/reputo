import { type CommunityLogger, createDiscordAdapter } from '@reputo/community-api';
import { CommunityPlatform } from '@reputo/contracts';
import { Context } from '@temporalio/activity';
import config from '../../config/index.js';
import type {
  CommunityDependencyKey,
  CommunityDependencyResolverContext,
  DependencyResolverActivities,
  ResolveDependencyInput,
  ResolveDependencyResult,
} from '../../shared/types/index.js';
import { type CommunityFetchCheckpoint, type CommunityRequestStats, freezeCommunityDataset } from './dataset-engine.js';

/** Each community platform's fetch is its own dependency key. */
const PLATFORM_BY_DEPENDENCY_KEY: Record<CommunityDependencyKey, CommunityPlatform> = {
  'discord-activity': CommunityPlatform.discord,
};

export function createCommunityDependencyResolverActivities(
  ctx: CommunityDependencyResolverContext,
): DependencyResolverActivities {
  return {
    async resolveDependency(input: ResolveDependencyInput): Promise<ResolveDependencyResult> {
      const { dependencyKey, snapshotId, communityFetch } = input;
      const platform = PLATFORM_BY_DEPENDENCY_KEY[dependencyKey as CommunityDependencyKey];
      if (platform === undefined) {
        throw new Error(
          `community worker received unexpected dependency "${dependencyKey}"; supported: ${Object.keys(PLATFORM_BY_DEPENDENCY_KEY).join(', ')}`,
        );
      }
      if (communityFetch === undefined) {
        throw new Error(`community dependency "${dependencyKey}" requires the orchestrator's communityFetch input`);
      }

      const context = Context.current();
      const logger = context.log;
      const communityLogger: CommunityLogger = {
        debug: (payload) => logger.debug('community-api', payload as Record<string, unknown>),
        warn: (payload) => logger.warn('community-api', payload as Record<string, unknown>),
      };
      const requestStats: CommunityRequestStats = { requests: 0, rateLimitWaits: 0, rateLimitWaitMs: 0 };
      const adapter = createDiscordAdapter(
        {
          botToken: config.community.discordBotToken,
          requestTimeoutMs: config.community.requestTimeoutMs,
          retry: {
            maxAttempts: config.community.retryMaxAttempts,
            baseDelayMs: config.community.retryBaseDelayMs,
            maxDelayMs: config.community.retryMaxDelayMs,
          },
        },
        communityLogger,
        {
          onRequest: () => {
            requestStats.requests += 1;
          },
          onRateLimitWait: (delayMs) => {
            requestStats.rateLimitWaits += 1;
            requestStats.rateLimitWaitMs += delayMs;
          },
        },
      );

      logger.info('Resolving community dependency', {
        dependencyKey,
        snapshotId,
        platform,
        resourceCount: communityFetch.resourceIds.length,
        windowStart: communityFetch.windowStart,
        windowEnd: communityFetch.windowEnd,
      });

      const result = await freezeCommunityDataset({
        snapshotId,
        platform,
        window: { start: communityFetch.windowStart, end: communityFetch.windowEnd },
        resourceIds: communityFetch.resourceIds,
        adapter,
        storage: ctx.storage,
        bucket: ctx.storageConfig.bucket,
        requestStats,
        progress: {
          heartbeat: (checkpoint) => context.heartbeat(checkpoint),
          lastCheckpoint: context.info.heartbeatDetails as CommunityFetchCheckpoint | undefined,
        },
        logger,
      });

      logger.info('Community dependency resolved', {
        dependencyKey,
        snapshotId,
        committed: result.committed,
        fetchStats: result.manifest.fetchStats,
      });

      return {};
    },
  };
}
