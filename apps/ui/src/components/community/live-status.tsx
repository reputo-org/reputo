import type { CommunityLiveState } from "@/lib/api/use-community-events"
import { cn } from "@/lib/utils"

interface LiveStatusProps {
  live: CommunityLiveState
}

/**
 * One line that says how fresh the page is: while the events stream is open
 * the API re-probes every connection on its watch cadence and pushes each
 * verdict here, so a permission change on the platform shows up within that
 * interval without anyone pressing Re-check.
 */
export function LiveStatus({ live }: LiveStatusProps) {
  const seconds =
    live.watchIntervalMs !== undefined && live.watchIntervalMs > 0
      ? Math.round(live.watchIntervalMs / 1000)
      : undefined

  const label = !live.connected
    ? "Reconnecting to live updates — refreshing every minute meanwhile"
    : seconds !== undefined
      ? `Live — every connection is re-checked every ${seconds} s while this page is open`
      : "Live — changes appear as the API sees them"

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
      {label}
    </p>
  )
}
