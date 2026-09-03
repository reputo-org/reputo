import type { CommunityPlatform } from "@/lib/api/types"
import type { CommunityLiveState } from "@/lib/api/use-community-events"
import { COMMUNITY_PLATFORMS } from "@/lib/community/platforms"
import { cn } from "@/lib/utils"

interface LiveStatusProps {
  live: CommunityLiveState
  /** Platforms with at least one connection — the only ones worth describing. */
  platforms: readonly CommunityPlatform[]
}

const LABELS: Record<CommunityPlatform, string> = Object.fromEntries(
  COMMUNITY_PLATFORMS.map((platform) => [platform.id, platform.label])
) as Record<CommunityPlatform, string>

/** "Discord", "Discord and GitHub", "Discord, GitHub and Mattermost". */
function list(platforms: readonly CommunityPlatform[]): string {
  const names = platforms.map((platform) => LABELS[platform])
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

/**
 * One line that says how this page stays fresh. Each platform pushes its own
 * changes — Discord over its gateway, GitHub over App webhooks, Mattermost over
 * its socket — so a permission change usually shows up here within a second. A
 * platform whose feed is down is named, with the cadence it is checked at
 * instead, because that is the difference the reader can actually feel.
 */
function describe(
  live: CommunityLiveState,
  platforms: readonly CommunityPlatform[]
): string {
  if (!live.connected) {
    return "Reconnecting to live updates — refreshing every minute meanwhile"
  }

  const feeds = live.realtime?.feeds
  if (!feeds || platforms.length === 0) {
    return "Live — changes appear as the API sees them"
  }

  const pushed = platforms.filter((platform) => feeds[platform] === "live")
  const polled = platforms.filter((platform) => feeds[platform] !== "live")
  if (polled.length === 0) {
    return `Live — ${list(pushed)} changes appear as they happen`
  }

  const seconds = Math.round((live.realtime?.fallbackIntervalMs ?? 0) / 1000)
  const reconnecting =
    polled.length === 1 ? "its feed reconnects" : "their feeds reconnect"
  const fallback =
    seconds > 0
      ? `checked every ${seconds} s while ${reconnecting}`
      : "checked by the next sweep"

  return pushed.length === 0
    ? `Live — ${list(polled)} ${fallback}`
    : `Live — ${list(pushed)} changes appear as they happen; ${list(polled)} ${fallback}`
}

export function LiveStatus({ live, platforms }: LiveStatusProps) {
  return (
    <p
      className="text-muted-foreground flex items-center gap-2 text-xs"
      role="status"
    >
      <span className="relative flex size-2" aria-hidden="true">
        {live.connected && (
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" />
        )}
        <span
          className={cn(
            "relative inline-flex size-2 rounded-full",
            live.connected
              ? "bg-emerald-500"
              : "border-muted-foreground/50 border-[1.5px]"
          )}
        />
      </span>
      {describe(live, platforms)}
    </p>
  )
}
