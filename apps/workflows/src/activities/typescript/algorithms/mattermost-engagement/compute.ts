import type { Storage } from '@reputo/storage';
import type { AlgorithmResult, Snapshot } from '../../../../shared/types/index.js';
import { computeCommunityEngagement } from '../community-engagement/index.js';

/**
 * Mattermost's activity enum, in the canonical order weights are applied in.
 * `active_day` is derived from message/reply rows, one credit per UTC day.
 * Mattermost resolves no mention list server-side and the fetch never reads
 * message text, so the platform has no `mention_received` activity.
 */
export const MATTERMOST_ACTIVITY_TYPES = [
  'message',
  'reply',
  'reaction_received',
  'reply_received',
  'active_day',
] as const;

export async function computeMattermostEngagement(snapshot: Snapshot, storage: Storage): Promise<AlgorithmResult> {
  return computeCommunityEngagement(
    {
      platform: 'mattermost',
      algorithmKey: 'mattermost_engagement',
      activityTypes: MATTERMOST_ACTIVITY_TYPES,
      activeDay: { type: 'active_day', sourceTypes: ['message', 'reply'] },
    },
    snapshot,
    storage,
  );
}
