import type {
  CommunityConnectionStatus,
  CommunityPlatform,
  CommunityResourceAccessIssue,
} from "@/lib/api/types"

export interface PlatformMeta {
  id: CommunityPlatform
  label: string
  description: string
  /** What one connection of this platform is called, e.g. "Add another server". */
  resourceNoun: string
}

export const COMMUNITY_PLATFORMS: readonly PlatformMeta[] = [
  {
    id: "discord",
    label: "Discord",
    description: "Use messages, replies, and reactions from selected channels.",
    resourceNoun: "server",
  },
  {
    id: "github",
    label: "GitHub",
    description:
      "Use pull requests, reviews, issues, and comments from selected repositories.",
    resourceNoun: "organization",
  },
  {
    id: "mattermost",
    label: "Mattermost",
    description: "Use messages, replies, and reactions from selected channels.",
    resourceNoun: "team",
  },
]

/**
 * Semantic weight of a lifecycle state, shared with the snapshot badges so
 * healthy reads emerald and failed reads red everywhere in the app. Colour only
 * ever reinforces the label — the word is always shown.
 */
export type StatusTone = "positive" | "warning" | "critical" | "neutral"

export interface StatusMeta {
  label: string
  tone: StatusTone
  description: string
}

const STATUS_META: Record<CommunityConnectionStatus, StatusMeta> = {
  pending: {
    label: "Checking",
    tone: "neutral",
    description: "Reputo is checking this connection for the first time.",
  },
  active: {
    label: "Connected",
    tone: "positive",
    description: "Reputo can read this community.",
  },
  degraded: {
    label: "Temporary issue",
    tone: "warning",
    description: "The last check failed. Try again before running a snapshot.",
  },
  broken: {
    label: "Action needed",
    tone: "critical",
    description: "Reputo cannot read this community until it is reconnected.",
  },
  disconnected: {
    label: "Disconnected",
    tone: "neutral",
    description: "An admin removed this connection.",
  },
}

export function describeStatus(status: CommunityConnectionStatus): StatusMeta {
  return STATUS_META[status]
}

/** A disconnected connection is kept for its history but can no longer be used. */
export function canRecheck(status: CommunityConnectionStatus): boolean {
  return status !== "disconnected"
}

export function canDisconnect(status: CommunityConnectionStatus): boolean {
  return status !== "disconnected"
}

/**
 * States an admin can only clear by authorizing the platform again. Reconnecting
 * runs the same install flow as a first connect — the API revives the existing
 * row rather than creating a second one.
 */
export function needsReconnect(status: CommunityConnectionStatus): boolean {
  return status === "broken" || status === "disconnected"
}

export interface AccessIssueMeta {
  /** Two or three words for a badge next to the resource. */
  label: string
  /** What blocks the bot and what the admin changes on the platform to fix it. */
  description: string
}

const ACCESS_ISSUE_META: Record<CommunityResourceAccessIssue, AccessIssueMeta> =
  {
    missing_view_channel: {
      label: "Can't view",
      description:
        "The bot does not have View Channel access. Allow it for the Reputo role in the channel settings.",
    },
    missing_read_history: {
      label: "No history",
      description:
        "The bot does not have Read Message History access. Allow it for the Reputo role in the channel settings.",
    },
    issues_disabled: {
      label: "Issues off",
      description:
        "Issues are disabled for this repository, so there is nothing to score. Enable them in the repository settings.",
    },
    not_member: {
      label: "Not a member",
      description:
        "The bot is not in this channel. Invite it from the channel's member list.",
    },
  }

const UNKNOWN_ACCESS_ISSUE: AccessIssueMeta = {
  label: "No access",
  description: "The bot cannot read this right now.",
}

/** Why an admin cannot use a listed resource. */
export function describeAccessIssue(
  issue: CommunityResourceAccessIssue | undefined
): AccessIssueMeta {
  return issue === undefined
    ? UNKNOWN_ACCESS_ISSUE
    : (ACCESS_ISSUE_META[issue] ?? UNKNOWN_ACCESS_ISSUE)
}

/** The access needed for each platform, shown under the picker. */
export const RESOURCE_ACCESS_RULE: Record<CommunityPlatform, string> = {
  discord:
    "A channel is available when the Reputo role has View Channel and Read Message History access.",
  github:
    "A repository is available when the GitHub App can access it and issues are enabled.",
  mattermost:
    "A channel is available when the bot has joined it or can read public channels.",
}

const CONNECT_ERROR_MESSAGES: Record<string, string> = {
  declined: "You cancelled the authorization before Reputo was connected.",
  approval_required:
    "An organization owner must approve the installation. Connect again after approval.",
  invalid_state:
    "That authorization link is no longer valid. Try connecting again.",
  auth_failed: "The platform rejected Reputo's credentials.",
  permission_denied:
    "Reputo is missing the read access it needs. Reconnect and grant it again.",
  not_found: "The community could not be found.",
  rate_limited:
    "The platform has limited Reputo's requests. Try again in a few minutes.",
  network_error: "The platform could not be reached. Try again shortly.",
  upstream_error: "The platform returned an error. Try again shortly.",
  contract_violation: "The platform sent a response that Reputo could not use.",
}

/** Wording that names what the admin must actually re-grant on that platform. */
const CONNECT_ERROR_MESSAGES_BY_PLATFORM: Partial<
  Record<CommunityPlatform, Record<string, string>>
> = {
  discord: {
    permission_denied:
      "The bot needs View Channels and Read Message History. Reconnect and grant both.",
  },
  github: {
    permission_denied:
      "The GitHub App needs read access to issues and pull requests. Reconnect and grant it.",
    not_found: "The GitHub App is no longer installed on that account.",
  },
  mattermost: {
    permission_denied:
      "The bot cannot read any channel of this team. Invite it to the channels it should read.",
    auth_failed:
      "Mattermost rejected the token. Reconnect with a valid bot token.",
  },
}

export const platformLabel = (id: string) =>
  COMMUNITY_PLATFORMS.find((entry) => entry.id === id)?.label ?? id

/**
 * Message for the `?connected=` / `?error=` / `?platform=` parameters the API
 * redirects back with after a connect attempt.
 */
export function describeConnectOutcome(params: {
  connected?: string | null
  error?: string | null
  platform?: string | null
}): { kind: "success" | "error"; message: string } | null {
  if (params.connected) {
    return {
      kind: "success",
      message: `${platformLabel(params.connected)} connected.`,
    }
  }

  if (!params.error) return null

  const perPlatform = params.platform
    ? CONNECT_ERROR_MESSAGES_BY_PLATFORM[params.platform as CommunityPlatform]
    : undefined

  return {
    kind: "error",
    message:
      perPlatform?.[params.error] ??
      CONNECT_ERROR_MESSAGES[params.error] ??
      "The connection attempt did not finish.",
  }
}
