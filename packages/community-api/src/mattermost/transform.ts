import { CommunityContractError, CommunityOutboundPolicyError } from '../shared/errors.js';
import type { CommunityResource } from '../shared/types.js';
import type {
  MattermostRawChannel,
  MattermostRawPost,
  MattermostRawPostList,
  MattermostRawTeam,
  MattermostTeam,
} from './types.js';

/** Channel types the pipeline reads: open, and private where the bot is invited. */
const READABLE_CHANNEL_TYPES = new Set(['O', 'P']);

/**
 * Canonical server origin — scheme, host, and port, nothing else. The origin
 * keys the connection (`{origin}/{teamId}`), so `http://` and `https://` on
 * the same host can never collide, and a pasted path or query is dropped.
 */
export function normalizeMattermostServerUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new CommunityOutboundPolicyError('The server URL is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new CommunityOutboundPolicyError('Only http(s) server URLs are allowed.');
  }
  return url.origin;
}

export function buildMattermostExternalId(serverUrl: string, teamId: string): string {
  return `${normalizeMattermostServerUrl(serverUrl)}/${teamId}`;
}

/** Splits `{origin}/{teamId}` back apart; the team id never contains a slash. */
export function parseMattermostExternalId(externalId: string): { serverUrl: string; teamId: string } {
  const separator = externalId.lastIndexOf('/');
  const serverUrl = separator > 0 ? externalId.slice(0, separator) : '';
  const teamId = separator > 0 ? externalId.slice(separator + 1) : '';

  if (serverUrl === '' || teamId === '' || !/^https?:\/\/[^/]+$/.test(serverUrl)) {
    throw new CommunityContractError('The Mattermost connection id is not in the {origin}/{teamId} form.');
  }
  return { serverUrl, teamId };
}

export function assertMattermostUser(user: unknown): void {
  const id = (user as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new CommunityContractError('Mattermost /users/me answered without a user id.');
  }
}

/** Active teams of the token's account, in the server's order. */
export function toMattermostTeams(teams: unknown): MattermostTeam[] {
  if (!Array.isArray(teams)) {
    throw new CommunityContractError('Mattermost team listing was not an array.');
  }

  return (teams as MattermostRawTeam[])
    .filter(
      (team): team is MattermostRawTeam & { id: string } =>
        typeof team?.id === 'string' &&
        team.id.length > 0 &&
        !(typeof team.delete_at === 'number' && team.delete_at > 0),
    )
    .map((team) => {
      const name = typeof team.name === 'string' && team.name.length > 0 ? team.name : team.id;
      return {
        id: team.id,
        name,
        displayName: typeof team.display_name === 'string' && team.display_name.length > 0 ? team.display_name : name,
      };
    });
}

/** Channels the bot is in, active only, alphabetical by shown name. */
export function toMattermostResources(channels: unknown): CommunityResource[] {
  if (!Array.isArray(channels)) {
    throw new CommunityContractError('Mattermost channel listing was not an array.');
  }

  return (channels as MattermostRawChannel[])
    .filter(
      (channel): channel is MattermostRawChannel & { id: string; type: string } =>
        typeof channel?.id === 'string' &&
        typeof channel.type === 'string' &&
        READABLE_CHANNEL_TYPES.has(channel.type) &&
        !(typeof channel.delete_at === 'number' && channel.delete_at > 0),
    )
    .map((channel) => {
      const displayName = typeof channel.display_name === 'string' && channel.display_name.length > 0;
      const name = displayName ? (channel.display_name as string) : channel.name;
      return {
        id: channel.id,
        name: typeof name === 'string' && name.length > 0 ? name : channel.id,
        kind: 'text' as const,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Post count of one history page. The probe proves the fields the fetch will
 * later need arrive for this token; the content itself is discarded unread.
 */
export function countMattermostPosts(page: MattermostRawPostList): number {
  const order = page?.order;
  const posts = page?.posts;
  if (!Array.isArray(order) || posts === null || typeof posts !== 'object') {
    throw new CommunityContractError('Mattermost post listing did not carry an order array and a posts map.');
  }

  for (const id of order) {
    const post = (posts as Record<string, MattermostRawPost>)[String(id)];
    if (typeof post?.id !== 'string' || typeof post.user_id !== 'string' || typeof post.create_at !== 'number') {
      throw new CommunityContractError(
        'Mattermost returned posts without an id, author id, or timestamp; the fetch cannot score this server.',
      );
    }
  }
  return order.length;
}
