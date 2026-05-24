"use client"

import {
  AlertCircle,
  BarChart3,
  Edit,
  Eye,
  FolderOpen,
  Loader2,
  Play,
  Trash2,
} from "lucide-react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { Button } from "@/components/ui/button"
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
  useCreateAlgorithmPreset,
  useCreateSnapshot,
  useDeleteAlgorithmPreset,
  useUpdateAlgorithmPreset,
} from "@/lib/api/hooks"
import type {
  AlgorithmPresetResponseDto,
  CreateAlgorithmPresetDto,
  CreateSnapshotDto,
  UpdateAlgorithmPresetDto,
} from "@/lib/api/types"
import { CreatePresetDialog } from "./create-preset-dialog"
import { EditPresetDialog } from "./edit-preset-dialog"
import { PresetDeleteDialog } from "./preset-delete-dialog"
import { PresetDetailsDialog } from "./preset-details-dialog"

function toTitleCase(str: string): string {
  return str
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function AlgorithmPresets({ algo }: { algo?: Algorithm }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [presetToDelete, setPresetToDelete] = useState<string | null>(null)
  const [presetToView, setPresetToView] =
    useState<AlgorithmPresetResponseDto | null>(null)
  const [presetToEdit, setPresetToEdit] =
    useState<AlgorithmPresetResponseDto | null>(null)
  const [runningPresetId, setRunningPresetId] = useState<string | null>(null)
  const [updatingPresetId, setUpdatingPresetId] = useState<string | null>(null)
  const [deletingPresetId, setDeletingPresetId] = useState<string | null>(null)

  const {
    data: presetsData,
    isLoading,
    error,
  } = useAlgorithmPresets({
    key: algo?.id,
    limit: 50,
  })
  const createPresetMutation = useCreateAlgorithmPreset()
  const updatePresetMutation = useUpdateAlgorithmPreset()
  const deletePresetMutation = useDeleteAlgorithmPreset()
  const createSnapshotMutation = useCreateSnapshot()

  const handleCreatePreset = async (data: CreateAlgorithmPresetDto) => {
    await createPresetMutation.mutateAsync(data)
  }

  const handleDeletePreset = async (presetId: string) => {
    setPresetToDelete(presetId)
    setIsDeleteDialogOpen(true)
  }

  const handleViewPreset = (preset: AlgorithmPresetResponseDto) => {
    setPresetToView(preset)
    setIsDetailsDialogOpen(true)
  }

  const handleEditPreset = (preset: AlgorithmPresetResponseDto) => {
    setPresetToEdit(preset)
    setIsEditDialogOpen(true)
  }

  const handleUpdatePreset = async (data: UpdateAlgorithmPresetDto) => {
    if (!presetToEdit) return
    setUpdatingPresetId(presetToEdit._id)
    try {
      await updatePresetMutation.mutateAsync({
        id: presetToEdit._id,
        data,
      })
    } finally {
      setUpdatingPresetId(null)
    }
  }

  const confirmDeletePreset = async () => {
    if (!presetToDelete) return

    setDeletingPresetId(presetToDelete)
    try {
      await deletePresetMutation.mutateAsync(presetToDelete)
      setIsDeleteDialogOpen(false)
      setPresetToDelete(null)
    } catch (error) {
      console.error("Failed to delete preset:", error)
    } finally {
      setDeletingPresetId(null)
    }
  }

  const handleRunPreset = async (presetId: string) => {
    try {
      setRunningPresetId(presetId)
      const snapshotData: CreateSnapshotDto = {
        algorithmPresetId: presetId,
        outputs: {},
      }

      await createSnapshotMutation.mutateAsync(snapshotData)

      const params = new URLSearchParams(searchParams.toString())
      params.set("tab", "snapshots")
      params.set("preset", presetId)
      router.push(`${pathname}?${params.toString()}`)
    } catch (error) {
      console.error("Failed to create snapshot:", error)
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Presets</h2>
          <p className="text-sm text-muted-foreground">
            Manage algorithm workflows and condition dependencies
          </p>
        </div>
        <CreatePresetDialog
          algo={algo}
          onCreatePreset={handleCreatePreset}
          isLoading={createPresetMutation.isPending}
        />
      </div>

      {isLoading ? (
        <Empty className="h-[400px]">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Loader2 className="size-6 animate-spin" />
            </EmptyMedia>
            <EmptyTitle>Loading Presets</EmptyTitle>
            <EmptyDescription>
              Please wait while we fetch your algorithm presets...
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : error ? (
        <Empty className="h-[400px]">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <AlertCircle className="size-6 text-red-500" />
            </EmptyMedia>
            <EmptyTitle>Failed to Load Presets</EmptyTitle>
            <EmptyDescription>
              There was an error loading your presets. Please try again.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={() => window.location.reload()}>
              Try Again
            </Button>
          </EmptyContent>
        </Empty>
      ) : presetsData?.results.length === 0 ? (
        <Empty className="h-[400px]">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderOpen className="size-6" />
            </EmptyMedia>
            <EmptyTitle>No Presets Found</EmptyTitle>
            <EmptyDescription>
              You haven't created any presets yet. Get started by creating your
              first preset.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent></EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-4">
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
              {presetsData?.results.map((preset) => (
                <TableRow key={preset._id}>
                  <TableCell className="max-w-[200px]">
                    <div className="flex flex-col">
                      <div className="font-medium truncate">
                        {preset.name || `${preset.key} preset`}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {preset.inputs.length} inputs
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[250px]">
                    <div className="flex flex-col">
                      <div className="font-medium truncate">
                        {toTitleCase(preset.key)}
                      </div>
                      <div className="text-muted-foreground text-xs truncate">
                        {preset.description || `Algorithm preset`}
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
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Run"
                        onClick={() => handleRunPreset(preset._id)}
                        disabled={runningPresetId === preset._id}
                      >
                        {runningPresetId === preset._id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Play className="size-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="View"
                        onClick={() => handleViewPreset(preset)}
                      >
                        <Eye className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="View Snapshots"
                        onClick={() => handleViewSnapshots(preset._id)}
                      >
                        <BarChart3 className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Edit"
                        onClick={() => handleEditPreset(preset)}
                        disabled={updatingPresetId === preset._id}
                      >
                        {updatingPresetId === preset._id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Edit className="size-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete"
                        onClick={() => handleDeletePreset(preset._id)}
                        disabled={deletingPresetId === preset._id}
                      >
                        {deletingPresetId === preset._id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Trash2 className="size-4" />
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="text-center text-sm text-muted-foreground">
            Manage algorithm workflows and condition dependencies
          </div>
        </div>
      )}

      <PresetDetailsDialog
        isOpen={isDetailsDialogOpen}
        onClose={() => setIsDetailsDialogOpen(false)}
        preset={presetToView}
      />

      <EditPresetDialog
        isOpen={isEditDialogOpen}
        onClose={() => {
          setIsEditDialogOpen(false)
          setPresetToEdit(null)
        }}
        preset={presetToEdit}
        onUpdatePreset={handleUpdatePreset}
        isLoading={updatePresetMutation.isPending}
        error={updatePresetMutation.error}
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
