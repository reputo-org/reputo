import { Context } from '@temporalio/activity';

import type {
  DependencyResolverActivities,
  OnchainDataSyncContext,
  ResolveDependencyInput,
  ResolveDependencyResult,
} from '../../shared/types/index.js';
import { createOnchainDataSyncActivity } from './onchain-data.activities.js';

export function createOnchainDataDependencyResolverActivities(
  ctx: OnchainDataSyncContext,
): DependencyResolverActivities {
  const onchainDataSync = createOnchainDataSyncActivity(ctx);

  return {
    async resolveDependency(input: ResolveDependencyInput): Promise<ResolveDependencyResult> {
      const logger = Context.current().log;
      const { dependencyKey, snapshotId, syncTargets } = input;

      if (dependencyKey !== 'onchain-data') {
        throw new Error(
          `onchain-data worker received unexpected dependency "${dependencyKey}"; only "onchain-data" is supported`,
        );
      }

      logger.info('Resolving dependency', {
        dependencyKey,
        snapshotId,
        syncTargetCount: syncTargets?.length ?? 0,
      });

      await onchainDataSync(syncTargets ?? []);

      logger.info('Dependency resolved successfully', {
        dependencyKey,
        snapshotId: snapshotId,
      });

      return {};
    },
  };
}
