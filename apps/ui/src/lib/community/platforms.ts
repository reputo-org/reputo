import type {
  CommunityConnectionStatus,
  CommunityPlatform,
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
    available: false,
  },
  {
    id: "mattermost",
    label: "Mattermost",
    description:
      "Score messages, replies, and reactions across a team's channels.",
    resourceNoun: "team",
    available: false,
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

/**
 * Message for the `?connected=` / `?error=` parameters the API redirects back
 * with after a connect attempt.
 */
export function describeConnectOutcome(params: {
  connected?: string | null
  error?: string | null
}): { kind: "success" | "error"; message: string } | null {
  if (params.connected) {
    const platform = COMMUNITY_PLATFORMS.find(
      (entry) => entry.id === params.connected
    )
    return {
      kind: "success",
      message: `${platform?.label ?? params.connected} connected.`,
    }
  }

  if (!params.error) return null

  const messages: Record<string, string> = {
    declined: "The authorization was cancelled before the bot was installed.",
    invalid_state:
      "That authorization link is no longer valid. Try connecting again.",
    auth_failed: "The platform rejected the bot credentials.",
    permission_denied:
      "The bot needs View Channels and Read Message History. Reconnect and grant both.",
    not_found: "The community could not be found.",
    rate_limited: "The platform is rate limiting Reputo. Try again shortly.",
    network_error: "The platform could not be reached. Try again shortly.",
    upstream_error: "The platform returned an error. Try again shortly.",
    contract_violation: "The platform returned an unexpected response.",
  }

  return {
    kind: "error",
    message: messages[params.error] ?? "The connection attempt did not finish.",
  }
}
