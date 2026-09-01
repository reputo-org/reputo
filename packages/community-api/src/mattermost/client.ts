import { CommunityPermissionError } from '../shared/errors.js';
import type { CommunityLogger } from '../shared/http.js';
import type { CommunityProbeResult, CommunityResource } from '../shared/types.js';
import { createMattermostRequest } from './request.js';
import {
  assertMattermostUser,
  countMattermostPosts,
  normalizeMattermostServerUrl,
  toMattermostResources,
  toMattermostTeams,
} from './transform.js';
import type {
  MattermostClientConfig,
  MattermostConnectionTarget,
  MattermostRawChannel,
  MattermostRawPostList,
  MattermostRawTeam,
  MattermostRawUser,
  MattermostTeam,
  MattermostTeamTarget,
} from './types.js';

/** Channels the probe will try before concluding that nothing is readable. */
const PROBE_CHANNEL_LIMIT = 10;
const PROBE_POSTS_PER_PAGE = 30;

export interface MattermostValidationResult {
  /** Canonical origin of the server — the identity half of the connection key. */
  serverUrl: string;
  teams: MattermostTeam[];
}

export interface MattermostClient {
  /** Verifies the token and lists its teams. Reads nothing else and stores nothing. */
  validateToken(target: MattermostConnectionTarget): Promise<MattermostValidationResult>;
  /** Open channels plus the private ones the bot was invited into. */
  listResources(target: MattermostTeamTarget): Promise<CommunityResource[]>;
  /** Lists channels and reads one page of posts to verify the granted permissions. */
  probe(target: MattermostTeamTarget): Promise<CommunityProbeResult>;
}

export function createMattermostClient(config: MattermostClientConfig, logger: CommunityLogger): MattermostClient {
  const call = createMattermostRequest(config, logger);

  const listRawChannels = async (target: MattermostTeamTarget): Promise<CommunityResource[]> => {
    const response = await call<MattermostRawChannel[]>(
      target,
      'GET',
      `/users/me/teams/${encodeURIComponent(target.teamId)}/channels`,
    );
    return toMattermostResources(response.data ?? []);
  };

  return {
    async validateToken(target) {
      const serverUrl = normalizeMattermostServerUrl(target.serverUrl);
      const me = await call<MattermostRawUser>(target, 'GET', '/users/me');
      assertMattermostUser(me.data);

      const teams = await call<MattermostRawTeam[]>(target, 'GET', '/users/me/teams');
      return { serverUrl, teams: toMattermostTeams(teams.data ?? []) };
    },

    async listResources(target) {
      return listRawChannels(target);
    },

    async probe(target) {
      const resources = await listRawChannels(target);

      for (const resource of resources.slice(0, PROBE_CHANNEL_LIMIT)) {
        try {
          const response = await call<MattermostRawPostList>(
            target,
            'GET',
            `/channels/${encodeURIComponent(resource.id)}/posts?page=0&per_page=${PROBE_POSTS_PER_PAGE}`,
          );

          return {
            resourceCount: resources.length,
            sampledResourceId: resource.id,
            sampledRecordCount: countMattermostPosts(response.data ?? {}),
          };
        } catch (error) {
          // A channel the bot cannot read is normal; only a team with no
          // readable channel at all is a failed probe.
          if (error instanceof CommunityPermissionError) continue;
          throw error;
        }
      }

      throw new CommunityPermissionError(
        resources.length === 0
          ? 'The bot is not in any channel of this team. Invite it to the channels it should read.'
          : 'The bot cannot read post history in any channel of this team.',
        403,
      );
    },
  };
}
