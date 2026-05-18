"use client"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatDateTime, formatRelativeFromNow } from "@/lib/admins/format"
import { cn } from "@/lib/utils"

interface TimeCellProps {
  value: string | null | undefined
  /** Footer line shown beneath the relative time, e.g. "by owner@example.com". */
  subtext?: string
  emptyLabel?: string
  className?: string
}

export function TimeCell({
  value,
  subtext,
  emptyLabel = "—",
  className,
}: TimeCellProps) {
  if (!value) {
    return (
      <span className="text-muted-foreground/70 text-xs">{emptyLabel}</span>
    )
  }

  const date = new Date(value)
  const isoLike = Number.isNaN(date.getTime()) ? value : date.toISOString()

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "text-foreground/80 inline-flex flex-col leading-tight",
            className
          )}
        >
          <time dateTime={isoLike} className="text-sm">
            {formatRelativeFromNow(value)}
          </time>
          {subtext ? (
            <span className="text-muted-foreground text-xs">{subtext}</span>
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <span className="font-mono text-xs">{formatDateTime(value)}</span>
      </TooltipContent>
    </Tooltip>
  )
}
