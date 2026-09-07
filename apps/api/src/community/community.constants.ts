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
  [CommunityErrorCategory.authFailed]:
    'The platform no longer accepts this connection. Reconnect to authorize Reputo again.',
  [CommunityErrorCategory.permissionDenied]:
    'Reputo does not have the read access it needs. Reconnect and grant access again.',
  [CommunityErrorCategory.notFound]: 'Reputo can no longer find this community. It may have been deleted.',
  [CommunityErrorCategory.rateLimited]: "The platform has limited Reputo's requests. Check again in a few minutes.",
  [CommunityErrorCategory.networkError]: 'The platform could not be reached. Check again in a few minutes.',
  [CommunityErrorCategory.upstreamError]: 'The platform returned an error. Check again in a few minutes.',
  [CommunityErrorCategory.contractViolation]: 'The platform sent a response that Reputo could not use.',
  [CommunityErrorCategory.outboundPolicy]: 'The server address is not allowed. Enter a public HTTPS address.',
  [CommunityLocalErrorCategory.invalidState]: 'The authorization link is no longer valid. Connect again.',
  [CommunityLocalErrorCategory.declined]: 'You cancelled the authorization before Reputo was connected.',
  [CommunityLocalErrorCategory.approvalRequired]:
    'An organization owner must approve the installation. Connect again after approval.',
  [CommunityLocalErrorCategory.teamNotFound]: 'The bot is not a member of that team. Select one of its teams.',
};

/** Wording that names what the admin must actually re-grant on that platform. */
const REASON_BY_PLATFORM: Partial<Record<CommunityPlatform, Record<string, string>>> = {
  discord: {
    [CommunityErrorCategory.permissionDenied]:
      'The bot is no longer in this server, or it is missing View Channels or Read Message History in every channel. Reconnect and grant both.',
    // A kicked bot is answered with 404 as often as with 403, so this has to
    // read as a kick first: the generic wording blames a deleted server and
    // never tells the admin that reconnecting is the fix.
    [CommunityErrorCategory.notFound]:
      'The bot is no longer in this server, or the server no longer exists. Reconnect to add it again.',
  },
  github: {
    [CommunityErrorCategory.authFailed]: 'The GitHub App was removed or suspended. Reconnect and install it again.',
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

/** Why the bot cannot read one listed resource, as a sentence fragment. */
const ACCESS_ISSUE_REASON: Record<string, string> = {
  [CommunityResourceAccessIssue.missingViewChannel]: 'the bot does not have View Channel access',
  [CommunityResourceAccessIssue.missingReadHistory]: 'the bot does not have Read Message History access',
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
