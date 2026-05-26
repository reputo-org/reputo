"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { SnapshotResponseDto } from "@/lib/api/types"
import { FileDisplay } from "../file-display"

interface SnapshotDetailsDialogProps {
  isOpen: boolean
  onClose: () => void
  snapshot: SnapshotResponseDto | null
}

/**
 * Check if a value looks like a storage key (file path)
 */
function isStorageKey(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false
  return value.includes("/") || value.startsWith("uploads/")
}

export function SnapshotDetailsDialog({
  isOpen,
  onClose,
  snapshot,
}: SnapshotDetailsDialogProps) {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case "running":
        return (
          <Badge variant="secondary" className="w-fit">
            Running
          </Badge>
        )
      case "completed":
        return (
          <Badge className="bg-foreground text-background border-transparent">
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Snapshot Details</DialogTitle>
          <DialogDescription>
            View detailed information about this snapshot execution
          </DialogDescription>
        </DialogHeader>
        {snapshot && (
          <div className="space-y-6 overflow-y-auto flex-1 min-h-0 pr-1">
            <div className="grid gap-4">
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">
                  Snapshot ID
                </h3>
                <p className="text-sm font-mono">{snapshot._id}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">
                  Status
                </h3>
                <div className="mt-1">{getStatusBadge(snapshot.status)}</div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">
                  Preset
                </h3>
                <p className="text-sm">
                  {snapshot.algorithmPresetFrozen?.name ||
                    (typeof snapshot.algorithmPreset === "string"
                      ? `Preset ${snapshot.algorithmPreset.slice(-8)}`
                      : "Unknown Preset")}
                </p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">
                  Created
                </h3>
                <p className="text-sm">
                  {new Date(snapshot.createdAt).toLocaleString()}
                </p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">
                  Last Updated
                </h3>
                <p className="text-sm">
                  {new Date(snapshot.updatedAt).toLocaleString()}
                </p>
              </div>
            </div>

            {snapshot.temporal && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">
                  Temporal Workflow
                </h3>
                <div className="space-y-2">
                  <div className="p-3 border rounded-lg">
                    <div className="font-medium">Workflow ID</div>
                    <div className="text-sm text-muted-foreground font-mono">
                      {snapshot.temporal.workflowId}
                    </div>
                  </div>
                  {snapshot.temporal.runId && (
                    <div className="p-3 border rounded-lg">
                      <div className="font-medium">Run ID</div>
                      <div className="text-sm text-muted-foreground font-mono">
                        {snapshot.temporal.runId}
                      </div>
                    </div>
                  )}
                  {snapshot.temporal.taskQueue && (
                    <div className="p-3 border rounded-lg">
                      <div className="font-medium">Task Queue</div>
                      <div className="text-sm text-muted-foreground">
                        {snapshot.temporal.taskQueue}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {snapshot.outputs && Object.keys(snapshot.outputs).length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-3">
                  Outputs
                </h3>
                <div className="space-y-2 pb-4">
                  {Object.entries(snapshot.outputs).map(([key, value]) => {
                    if (isStorageKey(value)) {
                      return (
                        <FileDisplay key={key} label={key} storageKey={value} />
                      )
                    }

                    return (
                      <div key={key} className="p-3 border rounded-lg">
                        <div className="font-medium mb-2">{key}</div>
                        <div className="text-sm text-muted-foreground break-all">
                          {typeof value === "object"
                            ? JSON.stringify(value, null, 2)
                            : String(value)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
