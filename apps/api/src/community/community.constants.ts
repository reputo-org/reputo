import { CommunityErrorCategory, CommunityResourceAccessIssue } from '@reputo/community-api';
import { CommunityConnectionStatus, type CommunityPlatform } from '@reputo/contracts';

/** Injection tokens for the configured platform clients. */
export const DISCORD_CLIENT = 'COMMUNITY_DISCORD_CLIENT';
export const GITHUB_CLIENT = 'COMMUNITY_GITHUB_CLIENT';
export const MATTERMOST_CLIENT = 'COMMUNITY_MATTERMOST_CLIENT';

/** Privileged operations recorded in `community_connection_audit`. */
export const CommunityAuditAction = {
  installUrl: 'install_url',
  validate: 'validate',
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
  /** The install was requested but still needs an organization owner's approval. */
  approvalRequired: 'approval_required',
  /** The token is valid but its bot is not a member of the selected team. */
  teamNotFound: 'team_not_found',
} as const;

export type CommunityAuditErrorCategory =
  | CommunityErrorCategory
  | (typeof CommunityLocalErrorCategory)[keyof typeof CommunityLocalErrorCategory];

/**
 * Lifecycle state a failed check leaves the connection in. Credential and
 * permission problems need an admin to reinstall the bot, so they are `broken`;
 * an outbound-policy refusal means the stored server address itself is no
 * longer acceptable; everything else is transient and only degrades the
 * connection.
 */
const BROKEN_CATEGORIES = new Set<string>([
  CommunityErrorCategory.authFailed,
  CommunityErrorCategory.permissionDenied,
  CommunityErrorCategory.notFound,
  CommunityErrorCategory.outboundPolicy,
]);

export function statusForFailure(category: CommunityAuditErrorCategory): CommunityConnectionStatus {
  return BROKEN_CATEGORIES.has(category) ? CommunityConnectionStatus.broken : CommunityConnectionStatus.degraded;
}

/** Short, safe sentence shown next to a non-active connection. */
const REASON_BY_CATEGORY: Record<string, string> = {
  [CommunityErrorCategory.authFailed]: "The platform rejected Reputo's credentials. Reconnect to authorize it again.",
  [CommunityErrorCategory.permissionDenied]:
    'Reputo is missing the read access it needs. Reconnect and grant it again.',
  [CommunityErrorCategory.notFound]: 'The community is no longer reachable. It may have been deleted.',
  [CommunityErrorCategory.rateLimited]: 'The platform is rate limiting Reputo. Try the check again shortly.',
  [CommunityErrorCategory.networkError]: 'The platform could not be reached. Try the check again shortly.',
  [CommunityErrorCategory.upstreamError]: 'The platform returned an error. Try the check again shortly.',
  [CommunityErrorCategory.contractViolation]: 'The platform returned an unexpected response.',
  [CommunityErrorCategory.outboundPolicy]:
    "The server address is blocked by Reputo's outbound network policy. Only public HTTPS hosts are allowed.",
  [CommunityLocalErrorCategory.invalidState]: 'The authorization link is no longer valid. Start again.',
  [CommunityLocalErrorCategory.declined]: 'The authorization was cancelled before Reputo was installed.',
  [CommunityLocalErrorCategory.approvalRequired]:
    'An organization owner still has to approve the install. Connect again once they have.',
  [CommunityLocalErrorCategory.teamNotFound]: 'The bot is not a member of that team. Pick one of its teams.',
};

/** Wording that names what the admin must actually re-grant on that platform. */
const REASON_BY_PLATFORM: Partial<Record<CommunityPlatform, Record<string, string>>> = {
  discord: {
    [CommunityErrorCategory.permissionDenied]:
      'The bot is no longer in this server, or it is missing View Channels or Read Message History in every channel. Reconnect and grant both.',
  },
  github: {
    [CommunityErrorCategory.authFailed]:
      'GitHub no longer accepts the App on this account: it was uninstalled or suspended. Reconnect and install it again.',
    [CommunityErrorCategory.permissionDenied]:
      'The GitHub App cannot read the repositories of this installation. Reconnect and grant read access to issues and pull requests.',
    [CommunityErrorCategory.notFound]: 'The GitHub App is no longer installed on this account.',
  },
  mattermost: {
    [CommunityErrorCategory.authFailed]: 'Mattermost rejected the token. Reconnect with a valid bot token.',
    [CommunityErrorCategory.permissionDenied]:
      'The bot cannot read any channel of this team. Invite it to the channels it should read.',
    [CommunityErrorCategory.notFound]: 'The server or team could not be found. Check the URL and reconnect.',
  },
};

export function describeErrorCategory(category: string, platform?: CommunityPlatform): string {
  const override = platform === undefined ? undefined : REASON_BY_PLATFORM[platform]?.[category];
  return override ?? REASON_BY_CATEGORY[category] ?? 'The last check did not succeed.';
}

/** Why the bot cannot read one listed resource, as a clause: "the bot lacks View Channel". */
const ACCESS_ISSUE_REASON: Record<string, string> = {
  [CommunityResourceAccessIssue.missingViewChannel]: 'the bot lacks View Channel',
  [CommunityResourceAccessIssue.missingReadHistory]: 'the bot lacks Read Message History',
  [CommunityResourceAccessIssue.issuesDisabled]: 'its issue tracker is disabled',
  [CommunityResourceAccessIssue.notMember]: 'the bot is not a member of it',
};

export function describeAccessIssue(issue: string | undefined): string {
  return ACCESS_ISSUE_REASON[issue ?? ''] ?? 'the bot cannot read it';
}

/** How a resource is named to a human: channels keep the `#` convention, repositories their full name. */
export function formatResourceName(resource: { name: string; kind: string }): string {
  return resource.kind === 'repository' ? resource.name : `#${resource.name}`;
}
