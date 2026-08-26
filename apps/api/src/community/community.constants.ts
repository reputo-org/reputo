import { CommunityErrorCategory } from '@reputo/community-api';
import { CommunityConnectionStatus } from '@reputo/contracts';

/** Injection token for the configured Discord client. */
export const DISCORD_CLIENT = 'COMMUNITY_DISCORD_CLIENT';

/** Privileged operations recorded in `community_connection_audit`. */
export const CommunityAuditAction = {
  installUrl: 'install_url',
  connect: 'connect',
  disconnect: 'disconnect',
  healthCheck: 'health_check',
  listResources: 'list_resources',
} as const;

export type CommunityAuditAction = (typeof CommunityAuditAction)[keyof typeof CommunityAuditAction];

export const CommunityAuditOutcome = {
  success: 'success',
  failure: 'failure',
} as const;

export type CommunityAuditOutcome = (typeof CommunityAuditOutcome)[keyof typeof CommunityAuditOutcome];

/** Failure categories the API adds to the platform-neutral ones. */
export const CommunityLocalErrorCategory = {
  /** The install state was missing, forged, replayed, or past its TTL. */
  invalidState: 'invalid_state',
  /** The admin dismissed the platform's authorization screen. */
  declined: 'declined',
} as const;

export type CommunityAuditErrorCategory =
  | CommunityErrorCategory
  | (typeof CommunityLocalErrorCategory)[keyof typeof CommunityLocalErrorCategory];

/**
 * Lifecycle state a failed check leaves the connection in. Credential and
 * permission problems need an admin to reinstall the bot, so they are `broken`;
 * everything else is transient and only degrades the connection.
 */
const BROKEN_CATEGORIES = new Set<string>([
  CommunityErrorCategory.authFailed,
  CommunityErrorCategory.permissionDenied,
  CommunityErrorCategory.notFound,
]);

export function statusForFailure(category: CommunityAuditErrorCategory): CommunityConnectionStatus {
  return BROKEN_CATEGORIES.has(category) ? CommunityConnectionStatus.broken : CommunityConnectionStatus.degraded;
}

/** Short, safe sentence shown next to a non-active connection. */
const REASON_BY_CATEGORY: Record<string, string> = {
  [CommunityErrorCategory.authFailed]: 'The platform rejected the bot credentials. Reconnect to authorize it again.',
  [CommunityErrorCategory.permissionDenied]:
    'The bot is missing View Channels or Read Message History. Reconnect and grant both.',
  [CommunityErrorCategory.notFound]: 'The community is no longer reachable. It may have been deleted.',
  [CommunityErrorCategory.rateLimited]: 'The platform is rate limiting Reputo. Try the check again shortly.',
  [CommunityErrorCategory.networkError]: 'The platform could not be reached. Try the check again shortly.',
  [CommunityErrorCategory.upstreamError]: 'The platform returned an error. Try the check again shortly.',
  [CommunityErrorCategory.contractViolation]: 'The platform returned an unexpected response.',
  [CommunityLocalErrorCategory.invalidState]: 'The authorization link expired or was already used. Start again.',
  [CommunityLocalErrorCategory.declined]: 'The authorization was cancelled before the bot was installed.',
};

export function describeErrorCategory(category: string): string {
  return REASON_BY_CATEGORY[category] ?? 'The last check did not succeed.';
}
