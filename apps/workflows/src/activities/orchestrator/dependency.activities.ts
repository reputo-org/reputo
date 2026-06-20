import { Context } from '@temporalio/activity';

import type {
  DependencyResolverActivities,
  OrchestratorDependencyResolverContext,
  ResolveDependencyInput,
  ResolveDependencyResult,
} from '../../shared/types/index.js';
import { createDeepIdSyncActivity } from './deep-id.activities.js';
import { createDeepfundingSyncActivity } from './deepfunding-portal-api.activities.js';

export function createOrchestratorDependencyResolverActivities(
  ctx: OrchestratorDependencyResolverContext,
): DependencyResolverActivities {
  const deepfundingSync = createDeepfundingSyncActivity({
    storage: ctx.storage,
    storageConfig: ctx.storageConfig,
  });
  const deepIdSync = createDeepIdSyncActivity({
    storage: ctx.storage,
    storageConfig: ctx.storageConfig,
  });

  return {
    async resolveDependency(input: ResolveDependencyInput): Promise<ResolveDependencyResult> {
      const logger = Context.current().log;
      const { dependencyKey, snapshotId } = input;

      logger.info('Resolving dependency', {
        dependencyKey,
        snapshotId,
      });

      let result: ResolveDependencyResult = {};
      switch (dependencyKey) {
        case 'deepfunding-portal-api':
          await deepfundingSync({ snapshotId });
          break;
        case 'deep-id': {
          const { didsKey } = await deepIdSync({ snapshotId });
          result = { didsKey };
          break;
        }
      }

      logger.info('Dependency resolved successfully', {
        dependencyKey,
        snapshotId,
      });

      return result;
    },
  };
}
