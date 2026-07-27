"use client"

import {
  AlertCircle,
  BarChart3,
  Copy,
  Eye,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { Algorithm } from "@/core/algorithms"
import {
  useAlgorithmPresets,
  useCreateSnapshot,
  useDeleteAlgorithmPreset,
} from "@/lib/api/hooks"
import type {
  AlgorithmPresetResponseDto,
  CreateSnapshotDto,
} from "@/lib/api/types"
import { cn } from "@/lib/utils"
import { PresetDeleteDialog } from "./preset-delete-dialog"
import { PresetDetailsDialog } from "./preset-details-dialog"
import { RunPresetDialog } from "./run-preset-dialog"

function toTitleCase(str: string): string {
  return str
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

const HIGHLIGHT_PARAMS = ["created", "updated"] as const
const HIGHLIGHT_TTL_MS = 4000

export function AlgorithmPresets({ algo }: { algo?: Algorithm }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false)
  const [presetToDelete, setPresetToDelete] = useState<string | null>(null)
  const [presetToView, setPresetToView] =
    useState<AlgorithmPresetResponseDto | null>(null)
  const [presetToRun, setPresetToRun] =
    useState<AlgorithmPresetResponseDto | null>(null)
  const [runningPresetId, setRunningPresetId] = useState<string | null>(null)
  const [deletingPresetId, setDeletingPresetId] = useState<string | null>(null)

  const highlightedId =
    searchParams.get("created") ?? searchParams.get("updated")
  const searchParamsString = searchParams.toString()

  // Callback ref: the highlighted row only exists once the list has loaded.
  const didScrollRef = useRef(false)
  const highlightRowRef = useCallback((node: HTMLTableRowElement | null) => {
    if (!node || didScrollRef.current) {
      return
    }
    didScrollRef.current = true
    node.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [])

  useEffect(() => {
    if (!highlightedId) {
      return
    }

    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams(searchParamsString)
      for (const key of HIGHLIGHT_PARAMS) {
        params.delete(key)
      }
      const query = params.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      })
    }, HIGHLIGHT_TTL_MS)

    return () => window.clearTimeout(timeout)
  }, [highlightedId, pathname, router, searchParamsString])

  const {
    data: presetsData,
    isLoading,
    error,
  } = useAlgorithmPresets({
    key: algo?.id,
    limit: 50,
  })
  const deletePresetMutation = useDeleteAlgorithmPreset()
  const createSnapshotMutation = useCreateSnapshot()

  const newPresetUrl = algo
    ? `/dashboard/algorithms/${algo.id}/presets/new`
    : null

  const handleDeletePreset = async (presetId: string) => {
    setPresetToDelete(presetId)
    setIsDeleteDialogOpen(true)
  }

  const handleViewPreset = (preset: AlgorithmPresetResponseDto) => {
    setPresetToView(preset)
    setIsDetailsDialogOpen(true)
  }

  const confirmDeletePreset = async () => {
    if (!presetToDelete) return

    setDeletingPresetId(presetToDelete)
    try {
      await deletePresetMutation.mutateAsync(presetToDelete)
      setIsDeleteDialogOpen(false)
      setPresetToDelete(null)
      toast.success("Preset deleted")
    } catch {
      toast.error("Could not delete the preset. Try again.")
    } finally {
      setDeletingPresetId(null)
    }
  }

  const confirmRunPreset = async () => {
    if (!presetToRun) return
    const presetId = presetToRun._id

    try {
      setRunningPresetId(presetId)
      const snapshotData: CreateSnapshotDto = {
        algorithmPresetId: presetId,
        outputs: {},
      }

      await createSnapshotMutation.mutateAsync(snapshotData)
      setPresetToRun(null)
      toast.success("Snapshot started")

      const params = new URLSearchParams(searchParams.toString())
      params.set("tab", "snapshots")
      params.set("preset", presetId)
      router.push(`${pathname}?${params.toString()}`)
    } catch {
      toast.error("Could not start the snapshot. Try again.")
    } finally {
      setRunningPresetId(null)
    }
  }

  const handleViewSnapshots = (presetId: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", "snapshots")
    params.set("preset", presetId)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Presets</h2>
          <p className="text-sm text-muted-foreground">
            Saved inputs{algo ? ` for ${algo.title}` : ""}. Run a preset to
            create a snapshot.
          </p>
        </div>
        {newPresetUrl && (
          <Button asChild size="sm">
            <Link href={newPresetUrl}>
              <Plus className="mr-2 size-4" /> New preset
            </Link>
          </Button>
        )}
      </div>

      {isLoading ? (
        <Empty className="h-[400px]">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Loader2 className="size-6 animate-spin" />
            </EmptyMedia>
            <EmptyTitle>Loading presets</EmptyTitle>
            <EmptyDescription>Getting your saved presets…</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : error ? (
        <Empty className="h-[400px]">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AlertCircle className="size-6 text-red-500" />
            </EmptyMedia>
            <EmptyTitle>Could not load presets</EmptyTitle>
            <EmptyDescription>
              Check your connection and try again.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </EmptyContent>
        </Empty>
      ) : presetsData?.results.length === 0 ? (
        <Empty className="h-[400px]">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen className="size-6" />
            </EmptyMedia>
            <EmptyTitle>No presets yet</EmptyTitle>
            <EmptyDescription>
              Save a set of inputs{algo ? ` for ${algo.title}` : ""} to use
              again.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {newPresetUrl && (
              <Button asChild>
                <Link href={newPresetUrl}>
                  <Plus className="mr-2 size-4" /> Create a preset
                </Link>
              </Button>
            )}
          </EmptyContent>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="max-w-[200px]">Preset</TableHead>
              <TableHead className="max-w-[250px]">Algorithm</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {presetsData?.results.map((preset) => {
              const isHighlighted = preset._id === highlightedId
              return (
                <TableRow
                  key={preset._id}
                  ref={isHighlighted ? highlightRowRef : undefined}
                  className={cn(
                    "transition-colors",
                    isHighlighted &&
                      "bg-primary/5 ring-1 ring-inset ring-primary/30"
                  )}
                >
                  <TableCell className="max-w-[200px]">
                    <div className="flex flex-col">
                      <div className="font-medium truncate">
                        {preset.name || `${preset.key} preset`}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {preset.inputs.length} input
                        {preset.inputs.length !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[250px]">
                    <div className="flex flex-col">
                      <div className="font-medium truncate">
                        {toTitleCase(preset.key)}
                      </div>
                      <div className="text-muted-foreground text-xs truncate">
                        {preset.description || "Algorithm preset"}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {preset.version}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {new Date(preset.createdAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPresetToRun(preset)}
                        disabled={runningPresetId === preset._id}
                      >
                        {runningPresetId === preset._id ? (
                          <Loader2 className="mr-2 size-4 animate-spin" />
                        ) : (
                          <Play className="mr-2 size-4" />
                        )}
                        Run
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Preset actions"
                            disabled={deletingPresetId === preset._id}
                          >
                            {deletingPresetId === preset._id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <MoreHorizontal className="size-4" />
                            )}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => handleViewPreset(preset)}
                          >
                            <Eye className="mr-2 size-4" /> View details
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => handleViewSnapshots(preset._id)}
                          >
                            <BarChart3 className="mr-2 size-4" /> View snapshots
                          </DropdownMenuItem>
                          {algo && (
                            <>
                              <DropdownMenuItem asChild>
                                <Link
                                  href={`/dashboard/algorithms/${algo.id}/presets/${preset._id}/edit`}
                                >
                                  <Pencil className="mr-2 size-4" /> Edit
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <Link
                                  href={`/dashboard/algorithms/${algo.id}/presets/new?from=${preset._id}`}
                                >
                                  <Copy className="mr-2 size-4" /> Duplicate
                                </Link>
                              </DropdownMenuItem>
                            </>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => handleDeletePreset(preset._id)}
                          >
                            <Trash2 className="mr-2 size-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      <PresetDetailsDialog
        isOpen={isDetailsDialogOpen}
        onClose={() => setIsDetailsDialogOpen(false)}
        preset={presetToView}
      />

      <RunPresetDialog
        isOpen={presetToRun !== null}
        presetName={presetToRun?.name ?? null}
        onClose={() => {
          if (runningPresetId === null) {
            setPresetToRun(null)
          }
        }}
        onConfirm={confirmRunPreset}
        isLoading={runningPresetId !== null}
      />

      <PresetDeleteDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => {
          setIsDeleteDialogOpen(false)
          setPresetToDelete(null)
        }}
        onConfirm={confirmDeletePreset}
        isLoading={deletePresetMutation.isPending}
      />
    </div>
  )
}
