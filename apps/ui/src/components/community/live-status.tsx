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
 * platform whose feed is down is named, because nothing brings its changes in
 * until the feed is back or somebody re-checks the connection.
 */
function describe(
  live: CommunityLiveState,
  platforms: readonly CommunityPlatform[]
): string {
  if (!live.connected) {
    return "Reconnecting to live updates"
  }

  const feeds = live.realtime?.feeds
  if (!feeds || platforms.length === 0) {
    return "Live — changes appear as the API sees them"
  }

  const pushed = platforms.filter((platform) => feeds[platform] === "live")
  const down = platforms.filter((platform) => feeds[platform] !== "live")
  if (down.length === 0) {
    return `Live — ${list(pushed)} changes appear as they happen`
  }

  const stalled =
    down.length === 1
      ? `the ${list(down)} feed is reconnecting`
      : `the ${list(down)} feeds are reconnecting`
  return pushed.length === 0
    ? `Not live — ${stalled}; Re-check to see changes now`
    : `Live — ${list(pushed)} changes appear as they happen; ${stalled}`
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
