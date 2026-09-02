import type { SafeOutboundPolicy } from '../shared/safe-fetch.js';
import type { CommunityHttpConfig } from '../shared/types.js';

export const MATTERMOST_API_PATH = '/api/v4';

/**
 * Transport settings plus the outbound policy. Mattermost is the one platform
 * whose origin is user-entered, so every call goes through the safe outbound
 * path — there is no unpoliced constructor.
 */
export interface MattermostClientConfig extends CommunityHttpConfig {
  outbound: SafeOutboundPolicy;
}

/**
 * A server + token pair. Held in memory for the duration of one call; the
 * caller owns sealing and unsealing.
 */
export interface MattermostConnectionTarget {
  serverUrl: string;
  token: string;
}

export interface MattermostTeamTarget extends MattermostConnectionTarget {
  teamId: string;
}

/** Team the token's bot account is a member of. */
export interface MattermostTeam {
  id: string;
  name: string;
  displayName: string;
}

/**
 * Transport plus the team the crawl reads. The adapter binds one team for the
 * whole fetch, so `iterateRecords` needs no per-resource credential.
 */
export interface MattermostAdapterConfig extends MattermostClientConfig {
  target: MattermostTeamTarget;
}

/** Raw shapes, narrowed before use — the transforms own the validation. */
export interface MattermostRawUser {
  id?: unknown;
  username?: unknown;
  is_bot?: unknown;
}

export interface MattermostRawTeam {
  id?: unknown;
  name?: unknown;
  display_name?: unknown;
  delete_at?: unknown;
}

export interface MattermostRawTeamStats {
  total_member_count?: unknown;
  active_member_count?: unknown;
}

export interface MattermostRawChannel {
  id?: unknown;
  name?: unknown;
  display_name?: unknown;
  type?: unknown;
  delete_at?: unknown;
}

export interface MattermostRawReaction {
  user_id?: unknown;
  post_id?: unknown;
}

export interface MattermostRawPost {
  id?: unknown;
  user_id?: unknown;
  create_at?: unknown;
  delete_at?: unknown;
  root_id?: unknown;
  type?: unknown;
  message?: unknown;
  metadata?: { reactions?: unknown } | null;
}

/** `GET /channels/{id}/posts` returns ids in `order` and the posts keyed by id. */
export interface MattermostRawPostList {
  order?: unknown;
  posts?: unknown;
}
