"use client"

import {
  AlertCircle,
  Eye,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  Trash2,
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  useDeleteSnapshot,
  useSnapshots,
} from "@/lib/api/hooks"
import type {
  AlgorithmPresetResponseDto,
  SnapshotResponseDto,
} from "@/lib/api/types"
import { useAuthAwareSnapshotEvents } from "@/lib/api/use-snapshot-events"
import { SnapshotDeleteDialog } from "./snapshot-delete-dialog"
import { SnapshotDetailsDialog } from "./snapshot-details-dialog"

type SnapshotStatus = SnapshotResponseDto["status"]

const STATUS_OPTIONS: Array<{ value: SnapshotStatus; label: string }> = [
  { value: "completed", label: "Completed" },
  { value: "running", label: "Running" },
  { value: "queued", label: "Queued" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
]

/**
 * The frozen preset is what the run actually used, so it names the row even
 * after the live preset is renamed or deleted.
 */
function getSnapshotPresetName(snapshot: SnapshotResponseDto): string {
  if (snapshot.algorithmPresetFrozen?.name) {
    return snapshot.algorithmPresetFrozen.name
  }

  if (
    snapshot.algorithmPreset &&
    typeof snapshot.algorithmPreset === "object"
  ) {
    const preset = snapshot.algorithmPreset as AlgorithmPresetResponseDto
    if (preset.name) {
      return preset.name
    }
    return `Preset ${preset._id?.slice(-8) ?? "unknown"}`
  }

  if (typeof snapshot.algorithmPreset === "string") {
    return `Preset ${snapshot.algorithmPreset.slice(-8)}`
  }

  return "Unknown preset"
}

export function AlgorithmSnapshots({ algo }: { algo?: Algorithm }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [selectedStatus, setSelectedStatus] = useState<SnapshotStatus | "all">(
    "all"
  )
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false)
  const [snapshotToDelete, setSnapshotToDelete] = useState<string | null>(null)
  const [snapshotToView, setSnapshotToView] =
    useState<SnapshotResponseDto | null>(null)
  const [deletingSnapshotId, setDeletingSnapshotId] = useState<string | null>(
    null
  )
  const [isMounted, setIsMounted] = useState(false)

  useEffect(() => {
    setIsMounted(true)
  }, [])

  const presetFilter = searchParams.get("preset")

  const {
    data: snapshotsData,
    isLoading,
    error,
  } = useSnapshots({
    key: algo?.id,
    algorithmPreset: presetFilter ?? undefined,
    status: selectedStatus !== "all" ? selectedStatus : undefined,
    limit: 50,
    populate: "algorithmPreset",
  })

  const { data: presetsData } = useAlgorithmPresets({
    key: algo?.id,
    limit: 100,
  })

  useAuthAwareSnapshotEvents({
    algorithmPreset: presetFilter ?? undefined,
    enabled: isMounted,
  })

  const deleteSnapshotMutation = useDeleteSnapshot()

  const newPresetUrl = algo
    ? `/dashboard/algorithms/${algo.id}/presets/new`
    : null

  const handlePresetFilterChange = (value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value === "all") {
      params.delete("preset")
    } else {
      params.set("preset", value)
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const handleDeleteSnapshot = (snapshotId: string) => {
    setSnapshotToDelete(snapshotId)
    setIsDeleteDialogOpen(true)
  }

  const handleViewSnapshot = (snapshot: SnapshotResponseDto) => {
    setSnapshotToView(snapshot)
    setIsDetailsDialogOpen(true)
  }

  const confirmDeleteSnapshot = async () => {
    if (!snapshotToDelete) return

    setDeletingSnapshotId(snapshotToDelete)
    try {
      await deleteSnapshotMutation.mutateAsync(snapshotToDelete)
      setIsDeleteDialogOpen(false)
      setSnapshotToDelete(null)
      toast.success("Snapshot deleted")
    } catch {
      toast.error("Failed to delete the snapshot. Please try again.")
    } finally {
      setDeletingSnapshotId(null)
    }
  }

  const getStatusBadge = (status: SnapshotStatus) => {
    switch (status) {
      case "running":
        return (
          <Badge variant="secondary" className="w-fit gap-1.5">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
            Running
          </Badge>
        )
      case "completed":
        return (
          <Badge className="bg-emerald-500 text-white border-transparent">
            Completed
          </Badge>
        )
      case "failed":
        return (
          <Badge className="bg-red-500 text-white border-transparent">
            Failed
          </Badge>
        )
      case "cancelled":
        return <Badge variant="outline">Cancelled</Badge>
      default:
        return <Badge variant="outline">Queued</Badge>
    }
  }

  const formatTimeAgo = (dateString: string) => {
    if (!isMounted) {
      return "—"
    }
    const date = new Date(dateString)
    const now = new Date()
    const diffInMinutes = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60)
    )

    if (diffInMinutes < 1) {
      return "just now"
    }
    if (diffInMinutes < 60) {
      return `${diffInMinutes} min ago`
    }
    if (diffInMinutes < 1440) {
      const hours = Math.floor(diffInMinutes / 60)
      return `${hours} hour${hours > 1 ? "s" : ""} ago`
    }
    const days = Math.floor(diffInMinutes / 1440)
    return `${days} day${days > 1 ? "s" : ""} ago`
  }

  const formatDuration = (snapshot: SnapshotResponseDto) => {
    if (!isMounted) {
      return "—"
    }

    if (!snapshot.startedAt || !snapshot.completedAt) {
      return "—"
    }

    const startTime = new Date(snapshot.startedAt).getTime()
    const endTime = new Date(snapshot.completedAt).getTime()
    const durationMs = endTime - startTime

    if (durationMs < 0) {
      return "—"
    }

    const seconds = Math.floor(durationMs / 1000)
    if (seconds < 60) {
      return `${seconds}s`
    }

    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60

    if (minutes < 60) {
      return remainingSeconds > 0
        ? `${minutes}m ${remainingSeconds}s`
        : `${minutes}m`
    }

    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
  }

  const filteredPresetName = presetFilter
    ? presetsData?.results.find((preset) => preset._id === presetFilter)?.name
    : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Snapshots</h2>
          <p className="text-sm text-muted-foreground">
            Runs of this algorithm's presets. Results appear here when a run
            completes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={presetFilter ?? "all"}
            onValueChange={handlePresetFilterChange}
          >
            <SelectTrigger className="w-48" aria-label="Filter by preset">
              <SelectValue placeholder="All presets" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All presets</SelectItem>
              {presetsData?.results.map((preset) => (
                <SelectItem key={preset._id} value={preset._id}>
                  {preset.name || `${preset.key} preset`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={selectedStatus}
            onValueChange={(value) =>
              setSelectedStatus(value as SnapshotStatus | "all")
            }
          >
            <SelectTrigger className="w-40" aria-label="Filter by status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <Empty className="h-[400px]">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Loader2 className="size-6 animate-spin" />
            </EmptyMedia>
            <EmptyTitle>Loading Snapshots</EmptyTitle>
            <EmptyDescription>
              Please wait while we fetch your snapshot executions...
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : error ? (
        <Empty className="h-[400px]">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AlertCircle className="size-6 text-red-500" />
            </EmptyMedia>
            <EmptyTitle>Failed to Load Snapshots</EmptyTitle>
            <EmptyDescription>
              There was an error loading your snapshots. Please try again.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Try Again
            </Button>
          </EmptyContent>
        </Empty>
      ) : snapshotsData?.results.length === 0 ? (
        <Empty className="h-[400px]">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Play className="size-6" />
            </EmptyMedia>
            <EmptyTitle>No Snapshots Yet</EmptyTitle>
            <EmptyDescription>
              {presetFilter || selectedStatus !== "all"
                ? "No snapshots match the current filters."
                : "Run a preset from the Presets tab to start a snapshot."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {presetFilter || selectedStatus !== "all" ? (
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedStatus("all")
                  handlePresetFilterChange("all")
                }}
              >
                Clear filters
              </Button>
            ) : (
              newPresetUrl && (
                <Button asChild variant="outline">
                  <Link href={newPresetUrl}>
                    <Plus className="mr-2 size-4" /> Create a preset
                  </Link>
                </Button>
              )
            )}
          </EmptyContent>
        </Empty>
      ) : (
        <>
          {filteredPresetName && (
            <p className="text-sm text-muted-foreground">
              Showing snapshots for{" "}
              <span className="font-medium text-foreground">
                {filteredPresetName}
              </span>
              .{" "}
              <button
                type="button"
                onClick={() => handlePresetFilterChange("all")}
                className="text-primary hover:underline"
              >
                Show all
              </button>
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="max-w-[200px]">Preset</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshotsData?.results.map((snapshot) => {
                const presetName = getSnapshotPresetName(snapshot)
                const outputCount = snapshot.outputs
                  ? Object.keys(snapshot.outputs).length
                  : 0

                return (
                  <TableRow key={snapshot._id}>
                    <TableCell className="max-w-[200px]">
                      <div className="flex flex-col">
                        <div className="font-medium truncate">{presetName}</div>
                        <div className="text-muted-foreground text-xs">
                          {outputCount} output{outputCount !== 1 ? "s" : ""}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(snapshot.status)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatTimeAgo(snapshot.createdAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDuration(snapshot)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewSnapshot(snapshot)}
                        >
                          <Eye className="mr-2 size-4" />
                          Details
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Snapshot actions"
                              disabled={deletingSnapshotId === snapshot._id}
                            >
                              {deletingSnapshotId === snapshot._id ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <MoreHorizontal className="size-4" />
                              )}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => handleViewSnapshot(snapshot)}
                            >
                              <Eye className="mr-2 size-4" /> View details
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() =>
                                handleDeleteSnapshot(snapshot._id)
                              }
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
        </>
      )}

      <SnapshotDetailsDialog
        isOpen={isDetailsDialogOpen}
        onClose={() => setIsDetailsDialogOpen(false)}
        snapshot={snapshotToView}
      />

      <SnapshotDeleteDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => {
          setIsDeleteDialogOpen(false)
          setSnapshotToDelete(null)
        }}
        onConfirm={confirmDeleteSnapshot}
        isLoading={deleteSnapshotMutation.isPending}
      />
    </div>
  )
}
