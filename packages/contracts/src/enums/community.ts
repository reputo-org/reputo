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
