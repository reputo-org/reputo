import type { Storage } from '@reputo/storage';
import type { AlgorithmResult, Snapshot } from '../../../../shared/types/index.js';
import { computeCommunityEngagement } from '../community-engagement/index.js';

/**
 * Discord's activity enum, in the canonical order weights are applied in.
 * `active_day` is derived from message/reply rows, one credit per UTC day.
 */
export const DISCORD_ACTIVITY_TYPES = [
  'message',
  'reply',
  'reaction_received',
  'reply_received',
  'mention_received',
  'active_day',
] as const;

export async function computeDiscordEngagement(snapshot: Snapshot, storage: Storage): Promise<AlgorithmResult> {
  return computeCommunityEngagement(
    {
      platform: 'discord',
      algorithmKey: 'discord_engagement',
      activityTypes: DISCORD_ACTIVITY_TYPES,
      activeDay: { type: 'active_day', sourceTypes: ['message', 'reply'] },
    },
    snapshot,
    storage,
  );
}
