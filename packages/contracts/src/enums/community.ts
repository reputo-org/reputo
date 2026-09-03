/**
 * Community platforms Reputo can connect to and score. The string values are
 * the canonical wire form and the Postgres enum labels.
 */
export const CommunityPlatform = {
  github: 'github',
  discord: 'discord',
  mattermost: 'mattermost',
} as const;

export type CommunityPlatform = (typeof CommunityPlatform)[keyof typeof CommunityPlatform];

export const COMMUNITY_PLATFORMS = Object.values(CommunityPlatform);

/**
 * Lifecycle of a community connection. A connection is `pending` until its
 * first capability probe succeeds, `degraded` when a probe fails transiently,
 * `broken` when the platform rejects the credentials, and `disconnected` once
 * an admin removes it.
 */
export const CommunityConnectionStatus = {
  pending: 'pending',
  active: 'active',
  degraded: 'degraded',
  broken: 'broken',
  disconnected: 'disconnected',
} as const;

export type CommunityConnectionStatus = (typeof CommunityConnectionStatus)[keyof typeof CommunityConnectionStatus];

export const COMMUNITY_CONNECTION_STATUSES = Object.values(CommunityConnectionStatus);

/**
 * Canonical, platform-neutral kinds of a selectable resource — a Discord
 * channel, a GitHub repository.
 */
export const CommunityResourceKind = {
  text: 'text',
  announcement: 'announcement',
  forum: 'forum',
  repository: 'repository',
} as const;

export type CommunityResourceKind = (typeof CommunityResourceKind)[keyof typeof CommunityResourceKind];

export const COMMUNITY_RESOURCE_KINDS = Object.values(CommunityResourceKind);

/**
 * Why the pipeline cannot read a listed resource. The UI turns each value into
 * the fix the admin has to make on the platform.
 */
export const CommunityResourceAccessIssue = {
  /** Discord: the bot lacks View Channel on this channel. */
  missingViewChannel: 'missing_view_channel',
  /** Discord: the bot can see the channel but lacks Read Message History. */
  missingReadHistory: 'missing_read_history',
  /** GitHub: the repository has its issue tracker disabled, so there is nothing to score. */
  issuesDisabled: 'issues_disabled',
  /** Mattermost: the bot is not in the channel and the server refuses reads without membership. */
  notMember: 'not_member',
} as const;

export type CommunityResourceAccessIssue =
  (typeof CommunityResourceAccessIssue)[keyof typeof CommunityResourceAccessIssue];

export const COMMUNITY_RESOURCE_ACCESS_ISSUES = Object.values(CommunityResourceAccessIssue);

/**
 * State of a platform's live feed — the Discord Gateway socket, GitHub App
 * webhook deliveries, a Mattermost WebSocket. A feed that is not `live` is
 * covered by polling, so the connection view stays correct either way; the
 * difference is only how fast a platform-side change shows up.
 */
export const CommunityFeedState = {
  /** The platform pushes its changes; nothing is polled for it. */
  live: 'live',
  /** Handshaking or reconnecting. Transient. */
  connecting: 'connecting',
  /** No live feed — turned off, unconfigured, or refused. Polling covers it. */
  down: 'down',
} as const;

export type CommunityFeedState = (typeof CommunityFeedState)[keyof typeof CommunityFeedState];

export const COMMUNITY_FEED_STATES = Object.values(CommunityFeedState);
