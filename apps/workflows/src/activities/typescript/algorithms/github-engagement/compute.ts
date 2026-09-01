import type { Storage } from '@reputo/storage';
import type { AlgorithmResult, Snapshot } from '../../../../shared/types/index.js';
import { computeCommunityEngagement } from '../community-engagement/index.js';

/**
 * GitHub's activity enum, in the canonical order weights are applied in.
 * A merged pull request is credited to its author at its merge time.
 */
export const GITHUB_ACTIVITY_TYPES = [
  'pull_request_opened',
  'pull_request_merged',
  'pull_request_review',
  'issue_opened',
  'comment',
] as const;

export async function computeGithubEngagement(snapshot: Snapshot, storage: Storage): Promise<AlgorithmResult> {
  return computeCommunityEngagement(
    {
      platform: 'github',
      algorithmKey: 'github_engagement',
      activityTypes: GITHUB_ACTIVITY_TYPES,
    },
    snapshot,
    storage,
  );
}
