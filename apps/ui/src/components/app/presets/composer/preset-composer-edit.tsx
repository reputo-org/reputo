"use client"

import { AlertCircle, Loader2 } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import type { Algorithm } from "@/core/algorithms"
import { useAlgorithmPreset } from "@/lib/api/hooks"
import { PresetComposer } from "./preset-composer"

interface PresetComposerEditProps {
  algo: Algorithm
  presetId: string
}

/** Edit-mode wrapper: loads the preset and guards mismatched algorithms. */
export function PresetComposerEdit({
  algo,
  presetId,
}: PresetComposerEditProps) {
  const { data: preset, isLoading, error } = useAlgorithmPreset(presetId)

  const presetsUrl = `/dashboard/algorithms/${algo.id}?tab=presets`

  if (isLoading) {
    return (
      <Empty className="h-[400px]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Loader2 className="size-6 animate-spin" />
          </EmptyMedia>
          <EmptyTitle>Loading preset</EmptyTitle>
          <EmptyDescription>Getting the preset…</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (error || !preset) {
    return (
      <Empty className="h-[400px]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AlertCircle className="size-6 text-red-500" />
          </EmptyMedia>
          <EmptyTitle>Preset not found</EmptyTitle>
          <EmptyDescription>
            The preset may have been deleted, or the link may be wrong.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline">
            <Link href={presetsUrl}>Back to presets</Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  if (preset.key !== algo.id) {
    return (
      <Empty className="h-[400px]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AlertCircle className="size-6 text-red-500" />
          </EmptyMedia>
          <EmptyTitle>Wrong algorithm</EmptyTitle>
          <EmptyDescription>
            This preset uses {preset.key}, not {algo.id}.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline">
            <Link
              href={`/dashboard/algorithms/${preset.key}/presets/${preset._id}/edit`}
            >
              Open {preset.key}
            </Link>
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return <PresetComposer algo={algo} mode="edit" basePreset={preset} />
}
