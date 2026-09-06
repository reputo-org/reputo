"use client"

import { Loader2 } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useEffect, useMemo, useRef } from "react"
import { toast } from "sonner"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import type { Algorithm } from "@/core/algorithms"
import { useAlgorithmPreset } from "@/lib/api/hooks"
import { CommunityConnectionGate } from "./community-connection-gate"
import {
  duplicatePresetName,
  suggestPresetDescription,
  suggestPresetName,
} from "./composer-suggestions"
import { PresetComposer } from "./preset-composer"

interface PresetComposerCreateProps {
  algo: Algorithm
}

/**
 * Create-mode wrapper: `?from=<presetId>` prefills the form from an
 * existing preset (duplicate); a missing or foreign source degrades to a
 * blank form with a toast.
 */
export function PresetComposerCreate({ algo }: PresetComposerCreateProps) {
  const searchParams = useSearchParams()
  const fromId = searchParams.get("from") ?? ""

  const { data: sourcePreset, isLoading, error } = useAlgorithmPreset(fromId)

  const sourceMatches = sourcePreset?.key === algo.id
  const warnedRef = useRef(false)

  useEffect(() => {
    if (warnedRef.current || !fromId) {
      return
    }
    if (error) {
      warnedRef.current = true
      toast.error("Could not load the preset. Starting with a blank form.")
    } else if (sourcePreset && !sourceMatches) {
      warnedRef.current = true
      toast.error(
        "That preset uses another algorithm. Starting with a blank form."
      )
    }
  }, [error, fromId, sourceMatches, sourcePreset])

  const suggestedName = useMemo(() => suggestPresetName(algo.title), [algo])
  const suggestedDescription = useMemo(
    () =>
      suggestPresetDescription({
        algorithmTitle: algo.title,
        algorithmSummary: algo.summary,
      }),
    [algo]
  )

  if (fromId && isLoading) {
    return (
      <Empty className="h-[400px]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Loader2 className="size-6 animate-spin" />
          </EmptyMedia>
          <EmptyTitle>Loading preset</EmptyTitle>
          <EmptyDescription>Getting the preset to copy…</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const base = fromId && sourceMatches ? sourcePreset : null

  // Create only: editing an existing preset must stay possible even while
  // its connection is unhealthy, so the edit route is never gated.
  return (
    <CommunityConnectionGate algo={algo}>
      <PresetComposer
        algo={algo}
        mode="create"
        basePreset={base}
        initialName={base ? duplicatePresetName(base.name) : suggestedName}
        initialDescription={suggestedDescription}
      />
    </CommunityConnectionGate>
  )
}
