"use client"

import { FileSpreadsheet } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface InputTypeBadgeProps {
  type: string
  label: string
}

const fileTypes = new Set(["csv", "file", "json", "xml"])

export function InputTypeBadge({ type, label }: InputTypeBadgeProps) {
  const isFileType = fileTypes.has(type)

  if (isFileType) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 text-xs font-medium">
              <FileSpreadsheet className="size-3" />
              {label}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">{label}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center px-2 py-1 rounded-md bg-muted text-muted-foreground text-xs font-medium">
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
