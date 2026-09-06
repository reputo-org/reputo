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
  /** Platforms whose connect flow lands in a later milestone task. */
  available: boolean
}

export const COMMUNITY_PLATFORMS: readonly PlatformMeta[] = [
  {
    id: "discord",
    label: "Discord",
    description:
      "Score messages, replies, and reactions across a server's channels.",
    resourceNoun: "server",
    available: true,
  },
  {
    id: "github",
    label: "GitHub",
    description:
      "Score pull requests, reviews, issues, and comments across selected repositories.",
    resourceNoun: "organization",
    available: true,
  },
  {
    id: "mattermost",
    label: "Mattermost",
    description:
      "Score messages, replies, and reactions across a team's channels.",
    resourceNoun: "team",
    available: true,
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
    label: "Pending",
    tone: "neutral",
    description: "Waiting for the first successful check.",
  },
  active: {
    label: "Active",
    tone: "positive",
    description: "Reputo can read this community.",
  },
  degraded: {
    label: "Degraded",
    tone: "warning",
    description: "The last check did not finish. Snapshots may be incomplete.",
  },
  broken: {
    label: "Broken",
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
        "The bot lacks View Channel here. Allow it for the Reputo role in the channel's permission settings.",
    },
    missing_read_history: {
      label: "No history",
      description:
        "The bot lacks Read Message History here. Allow it for the Reputo role in the channel's permission settings.",
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

/** Why a listed resource is unreadable, in the admin's terms. */
export function describeAccessIssue(
  issue: CommunityResourceAccessIssue | undefined
): AccessIssueMeta {
  return issue === undefined
    ? UNKNOWN_ACCESS_ISSUE
    : (ACCESS_ISSUE_META[issue] ?? UNKNOWN_ACCESS_ISSUE)
}

/** The rule that makes a resource readable on each platform, shown under the picker. */
export const RESOURCE_ACCESS_RULE: Record<CommunityPlatform, string> = {
  discord:
    "A channel is readable when the Reputo role has View Channel and Read Message History in it.",
  github:
    "A repository is readable when the App installation includes it and its issue tracker is on.",
  mattermost:
    "A channel is readable when the bot is a member of it, or when the server lets team members read public channels.",
}

const CONNECT_ERROR_MESSAGES: Record<string, string> = {
  declined: "The authorization was cancelled before Reputo was installed.",
  approval_required:
    "An organization owner still has to approve the install. Connect again once they have.",
  invalid_state:
    "That authorization link is no longer valid. Try connecting again.",
  auth_failed: "The platform rejected Reputo's credentials.",
  permission_denied:
    "Reputo is missing the read access it needs. Reconnect and grant it again.",
  not_found: "The community could not be found.",
  rate_limited: "The platform is rate limiting Reputo. Try again shortly.",
  network_error: "The platform could not be reached. Try again shortly.",
  upstream_error: "The platform returned an error. Try again shortly.",
  contract_violation: "The platform returned an unexpected response.",
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

const platformLabel = (id: string) =>
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
