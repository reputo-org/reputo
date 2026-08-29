import type { CommunityConnectionStatus } from "@/lib/api/types"
import { describeStatus, type StatusTone } from "@/lib/community/platforms"
import { cn } from "@/lib/utils"

const TONE_TEXT: Record<StatusTone, string> = {
  positive: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-500",
  critical: "text-red-600 dark:text-red-400",
  neutral: "text-muted-foreground",
}

const TONE_DOT: Record<StatusTone, string> = {
  positive: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-red-500",
  neutral: "bg-muted-foreground/50",
}

interface ConnectionStatusProps {
  status: CommunityConnectionStatus
}

/**
 * Dot plus word. `pending` shows a hollow dot so an unfinished first check
 * reads as "not settled yet" rather than as another neutral state.
 */
export function ConnectionStatus({ status }: ConnectionStatusProps) {
  const { label, tone, description } = describeStatus(status)

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap",
        TONE_TEXT[tone]
      )}
      title={description}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          status === "pending"
            ? "border-muted-foreground/50 border-[1.5px]"
            : TONE_DOT[tone]
        )}
      />
      {label}
    </span>
  )
}
