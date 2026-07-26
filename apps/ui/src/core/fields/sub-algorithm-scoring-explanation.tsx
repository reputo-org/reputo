"use client"

import type { AlgorithmNormalization } from "@reputo/reputation-algorithms"
import { ChevronDown, Info } from "lucide-react"
import { useState } from "react"
import ReactMarkdown from "react-markdown"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { describeNormalization } from "./sub-algorithm-composer-field.utils"

interface SubAlgorithmScoringExplanationProps {
  /** Canonical scoring copy from the algorithm definition (markdown). */
  copy?: string
  normalization?: AlgorithmNormalization | null
}

/**
 * Explains how sub-algorithm scores are normalized, weighted, and aggregated.
 * The algorithm definition is the canonical copy source; this component only
 * renders that copy plus the definition's active normalization metadata.
 */
export function SubAlgorithmScoringExplanation({
  copy,
  normalization,
}: SubAlgorithmScoringExplanationProps) {
  const [open, setOpen] = useState(false)

  if (!copy) {
    return null
  }

  const { methodLabel, targetMin, targetMax } =
    describeNormalization(normalization)

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border bg-muted/40"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <p className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">
          <Info className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            Current normalization method:{" "}
            <span className="font-medium text-foreground">{methodLabel}</span>
            {" · "}target range {targetMin}–{targetMax}
          </span>
        </p>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-1 rounded-sm text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            How scoring works
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform",
                open && "rotate-180"
              )}
              aria-hidden="true"
            />
          </button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent>
        <div className="border-t px-3 py-3">
          <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:text-sm prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5">
            <ReactMarkdown>{copy}</ReactMarkdown>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
