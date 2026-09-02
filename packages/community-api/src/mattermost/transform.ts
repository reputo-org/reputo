import { CommunityContractError, CommunityOutboundPolicyError } from '../shared/errors.js';
import {
  type CommunityActivityRecord,
  CommunityChatActivityType,
  type CommunityFetchWindow,
  isWithinWindow,
} from '../shared/records.js';
import type { CommunityProfile, CommunityResource } from '../shared/types.js';
import type {
  MattermostRawChannel,
  MattermostRawPost,
  MattermostRawPostList,
  MattermostRawReaction,
  MattermostRawTeam,
  MattermostRawTeamStats,
  MattermostRawUser,
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
/**
 * Display facts from the team stats. No avatar: the team image endpoint needs
 * the bot token, so there is no URL a browser could load unauthenticated.
 */
export function toMattermostTeamProfile(raw: MattermostRawTeamStats): CommunityProfile {
  const active = raw?.active_member_count;
  const total = raw?.total_member_count;
  const memberCount = typeof active === 'number' && Number.isFinite(active) ? active : total;

  return {
    memberCount: typeof memberCount === 'number' && Number.isFinite(memberCount) ? memberCount : undefined,
  };
}

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

/** Posts of one history page, in the server's order, plus the map the roots resolve from. */
export interface MattermostPostPage {
  posts: MattermostRawPost[];
  byId: Map<string, MattermostRawPost>;
}

/**
 * Narrows one `GET /channels/{id}/posts` response. `order` lists the requested
 * posts, newest first; `posts` additionally carries the thread roots of any
 * reply among them, so a reply's received row is credited without a second
 * request.
 */
export function toMattermostPostPage(page: MattermostRawPostList): MattermostPostPage {
  const order = page?.order;
  const posts = page?.posts;
  if (!Array.isArray(order) || posts === null || typeof posts !== 'object') {
    throw new CommunityContractError('Mattermost post listing did not carry an order array and a posts map.');
  }

  const byId = new Map(Object.entries(posts as Record<string, MattermostRawPost>));
  return {
    posts: order.map((id) => byId.get(String(id))).filter((post): post is MattermostRawPost => post !== undefined),
    byId,
  };
}

/** A post that carries the fields the crawl needs, already narrowed. */
export interface MattermostPost {
  id: string;
  userId: string;
  /** Creation time, ISO 8601 UTC — Mattermost sends Unix milliseconds. */
  occurredAt: string;
  rootId: string | null;
}

/**
 * A scoreable post: a human message that still exists. System posts carry a
 * non-empty `type`; deleted posts carry a non-zero `delete_at` and stay out of
 * the dataset, like content deleted before any other platform's fetch.
 * Anything without a stable author id or timestamp is dropped, never guessed.
 */
export function toScoreablePost(post: MattermostRawPost | undefined): MattermostPost | undefined {
  if (post === undefined || (typeof post.type === 'string' && post.type !== '')) {
    return undefined;
  }
  if (typeof post.delete_at === 'number' && post.delete_at > 0) {
    return undefined;
  }

  const { id, user_id: userId, create_at: createAt, root_id: rootId } = post;
  if (typeof id !== 'string' || id === '' || typeof userId !== 'string' || userId === '') {
    return undefined;
  }
  if (typeof createAt !== 'number' || !Number.isFinite(createAt) || createAt <= 0) {
    return undefined;
  }

  return {
    id,
    userId,
    occurredAt: new Date(createAt).toISOString(),
    rootId: typeof rootId === 'string' && rootId !== '' ? rootId : null,
  };
}

/** Reactor ids of one post, with how many reactions each of them left on it. */
export function toReactionCounts(post: MattermostRawPost): Map<string, number> {
  const counts = new Map<string, number>();
  const reactions = post?.metadata?.reactions;
  if (!Array.isArray(reactions)) {
    return counts;
  }

  for (const reaction of reactions as MattermostRawReaction[]) {
    const userId = reaction?.user_id;
    if (typeof userId === 'string' && userId !== '') {
      counts.set(userId, (counts.get(userId) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Maps one narrowed post to canonical, content-free activity rows, keeping only
 * rows whose defining timestamp falls inside the window. `isBot` answers for an
 * account id from the crawl's bulk lookup.
 *
 * - `message`/`reply` and the derived `reaction_received` rows use the post's
 *   own creation time.
 * - `reply_received` credits the thread root's author at the root's creation
 *   time, so a reply to a post outside the window yields no received row.
 * - Reactions record their reactor as the counterparty — Mattermost exposes it,
 *   unlike Discord — as one row per reactor. Self-reactions are not filtered;
 *   daily caps bound them at scoring time.
 */
export function toMattermostActivityRecords(
  post: MattermostPost,
  raw: MattermostRawPost,
  page: MattermostPostPage,
  resourceId: string,
  window: CommunityFetchWindow,
  isBot: (userId: string) => boolean,
): CommunityActivityRecord[] {
  const records: CommunityActivityRecord[] = [];
  const push = (record: CommunityActivityRecord) => {
    if (isWithinWindow(record.occurredAt, window)) {
      records.push(record);
    }
  };

  const root = post.rootId === null ? undefined : toScoreablePost(page.byId.get(post.rootId));
  const base = {
    resource: resourceId,
    objectId: post.id,
    occurredAt: post.occurredAt,
    actorIsBot: isBot(post.userId),
    deleted: false,
  };

  push({
    ...base,
    type: post.rootId === null ? CommunityChatActivityType.message : CommunityChatActivityType.reply,
    actor: post.userId,
    counterparty: root?.userId ?? null,
    count: 1,
  });

  for (const [reactorId, count] of toReactionCounts(raw)) {
    push({
      ...base,
      type: CommunityChatActivityType.reactionReceived,
      actor: post.userId,
      counterparty: reactorId,
      count,
    });
  }

  if (root !== undefined) {
    push({
      type: CommunityChatActivityType.replyReceived,
      actor: root.userId,
      counterparty: post.userId,
      resource: resourceId,
      objectId: post.id,
      occurredAt: root.occurredAt,
      count: 1,
      actorIsBot: isBot(root.userId),
      deleted: false,
    });
  }

  return records;
}

/** The accounts a bulk `/users/ids` or `/users/usernames` lookup answered with. */
export function toMattermostUsers(users: unknown): MattermostRawUser[] {
  if (!Array.isArray(users)) {
    throw new CommunityContractError('Mattermost user lookup did not answer with an array.');
  }
  return users as MattermostRawUser[];
}

/**
 * Account ids of a bulk username lookup, keyed by the requested username.
 * Usernames are unique on a Mattermost server, so the match is exact by
 * construction; a username the server did not answer for stays absent rather
 * than resolving to a near match.
 */
export function toAccountIdsByUsername(users: unknown, requested: readonly string[]): Map<string, string | null> {
  const byUsername = new Map<string, string | null>(requested.map((username) => [username, null]));

  for (const user of toMattermostUsers(users)) {
    const { id, username } = user;
    if (typeof id === 'string' && id !== '' && typeof username === 'string' && byUsername.has(username)) {
      byUsername.set(username, id);
    }
  }
  return byUsername;
}
