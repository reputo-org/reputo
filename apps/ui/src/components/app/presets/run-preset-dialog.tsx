"use client"

import { Loader2, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface RunPresetDialogProps {
  isOpen: boolean
  presetName: string | null
  onClose: () => void
  onConfirm: () => void
  isLoading: boolean
}

export function RunPresetDialog({
  isOpen,
  presetName,
  onClose,
  onConfirm,
  isLoading,
}: RunPresetDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Run preset</DialogTitle>
          <DialogDescription>
            Start a new snapshot{presetName ? ` for "${presetName}"` : ""}? The
            algorithm will run with this preset's inputs, and you'll be taken to
            the Snapshots tab to follow progress.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={onConfirm} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Play className="mr-2 size-4" />
            )}
            Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
