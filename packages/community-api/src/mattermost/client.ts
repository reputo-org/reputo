import { CommunityPermissionError } from '../shared/errors.js';
import type { CommunityLogger } from '../shared/http.js';
import {
  type CommunityProbeResult,
  type CommunityProfile,
  type CommunityResource,
  CommunityResourceAccessIssue,
  digestCommunityResources,
} from '../shared/types.js';
import { createMattermostRequest } from './request.js';
import {
  assertMattermostUser,
  countMattermostPosts,
  normalizeMattermostServerUrl,
  toMattermostResources,
  toMattermostTeamProfile,
  toMattermostTeams,
} from './transform.js';
import type {
  MattermostClientConfig,
  MattermostConnectionTarget,
  MattermostRawChannel,
  MattermostRawPostList,
  MattermostRawTeam,
  MattermostRawTeamStats,
  MattermostRawUser,
  MattermostTeam,
  MattermostTeamTarget,
} from './types.js';

/** Readable channels the probe will try before concluding that nothing is readable. */
const PROBE_CHANNEL_LIMIT = 10;
const PROBE_POSTS_PER_PAGE = 30;

/** Public channels per team listing page. 200 is Mattermost's maximum. */
const PUBLIC_CHANNELS_PAGE_LIMIT = 200;

export interface MattermostValidationResult {
  /** Canonical origin of the server — the identity half of the connection key. */
  serverUrl: string;
  teams: MattermostTeam[];
}

export interface MattermostClient {
  /** Verifies the token and lists its teams. Reads nothing else and stores nothing. */
  validateToken(target: MattermostConnectionTarget): Promise<MattermostValidationResult>;
  /**
   * Every open channel of the team plus the private ones the bot was invited
   * into, each marked readable or not under the token's current access.
   */
  listResources(target: MattermostTeamTarget): Promise<CommunityResource[]>;
  /** Lists channels and reads one page of posts to verify the granted permissions. */
  probe(target: MattermostTeamTarget): Promise<CommunityProbeResult>;
}

export function createMattermostClient(config: MattermostClientConfig, logger: CommunityLogger): MattermostClient {
  const call = createMattermostRequest(config, logger);

  // Best-effort display facts; a failure here never fails the probe.
  const fetchTeamProfile = async (target: MattermostTeamTarget): Promise<CommunityProfile | undefined> => {
    try {
      const response = await call<MattermostRawTeamStats>(
        target,
        'GET',
        `/teams/${encodeURIComponent(target.teamId)}/stats`,
      );
      return toMattermostTeamProfile(response.data ?? {});
    } catch {
      logger.warn({ platform: 'mattermost', message: 'Team stats lookup failed; probe continues without it.' });
      return undefined;
    }
  };

  const listJoinedChannels = async (target: MattermostTeamTarget): Promise<MattermostRawChannel[]> => {
    const response = await call<MattermostRawChannel[]>(
      target,
      'GET',
      `/users/me/teams/${encodeURIComponent(target.teamId)}/channels`,
    );
    return Array.isArray(response.data) ? response.data : [];
  };

  const listPublicChannels = async (target: MattermostTeamTarget): Promise<MattermostRawChannel[]> => {
    const channels: MattermostRawChannel[] = [];
    for (let page = 0; ; page++) {
      const response = await call<MattermostRawChannel[]>(
        target,
        'GET',
        `/teams/${encodeURIComponent(target.teamId)}/channels?page=${page}&per_page=${PUBLIC_CHANNELS_PAGE_LIMIT}`,
      );
      const listed = Array.isArray(response.data) ? response.data : [];
      channels.push(...listed);
      if (listed.length < PUBLIC_CHANNELS_PAGE_LIMIT) {
        return channels;
      }
    }
  };

  /**
   * Whether the token may read a public channel it has not joined. Mattermost
   * grants that through the team-level Read Public Channels permission and
   * withdraws it under compliance mode; either way it is one verdict for the
   * whole team, so one sampled read settles every unjoined public channel.
   */
  const canReadUnjoined = async (target: MattermostTeamTarget, channelId: string): Promise<boolean> => {
    try {
      await call<MattermostRawPostList>(
        target,
        'GET',
        `/channels/${encodeURIComponent(channelId)}/posts?page=0&per_page=1`,
      );
      return true;
    } catch (error) {
      if (error instanceof CommunityPermissionError) return false;
      throw error;
    }
  };

  /**
   * The channels the bot is in are readable by membership. Public channels it
   * has not joined are listed too — with the verdict above — so the picker can
   * show the whole team and name what an invite would unlock.
   */
  const listChannels = async (target: MattermostTeamTarget): Promise<CommunityResource[]> => {
    const [joinedRaw, publicRaw] = await Promise.all([listJoinedChannels(target), listPublicChannels(target)]);
    const joined = toMattermostResources(joinedRaw);
    const joinedIds = new Set(joined.map((resource) => resource.id));
    const unjoinedRaw = publicRaw.filter((channel) => typeof channel?.id !== 'string' || !joinedIds.has(channel.id));

    const sample = toMattermostResources(unjoinedRaw)[0];
    if (sample === undefined) {
      return joined;
    }

    const readable = await canReadUnjoined(target, sample.id);
    const unjoined = toMattermostResources(
      unjoinedRaw,
      readable ? { readable: true } : { readable: false, accessIssue: CommunityResourceAccessIssue.notMember },
    );
    return [...joined, ...unjoined].sort((a, b) => a.name.localeCompare(b.name));
  };

  return {
    async validateToken(target) {
      const serverUrl = normalizeMattermostServerUrl(target.serverUrl);
      const me = await call<MattermostRawUser>(target, 'GET', '/users/me');
      assertMattermostUser(me.data);

      const teams = await call<MattermostRawTeam[]>(target, 'GET', '/users/me/teams');
      return { serverUrl, teams: toMattermostTeams(teams.data ?? []) };
    },

    listResources: listChannels,

    async probe(target) {
      const resources = await listChannels(target);
      const readable = resources.filter((resource) => resource.readable);

      for (const resource of readable.slice(0, PROBE_CHANNEL_LIMIT)) {
        try {
          const response = await call<MattermostRawPostList>(
            target,
            'GET',
            `/channels/${encodeURIComponent(resource.id)}/posts?page=0&per_page=${PROBE_POSTS_PER_PAGE}`,
          );

          return {
            resourceCount: resources.length,
            readableResourceCount: readable.length,
            resourcesDigest: digestCommunityResources(resources),
            sampledResourceId: resource.id,
            sampledRecordCount: countMattermostPosts(response.data ?? {}),
            profile: await fetchTeamProfile(target),
          };
        } catch (error) {
          // A channel the bot lost between the listing and the read is normal;
          // only a team with no readable channel at all is a failed probe.
          if (error instanceof CommunityPermissionError) continue;
          throw error;
        }
      }

      throw new CommunityPermissionError(
        resources.length === 0
          ? 'This team has no channel the bot could read. Invite it to the channels it should score.'
          : 'The bot cannot read any channel of this team. Invite it to the channels it should score.',
        403,
      );
    },
  };
}
