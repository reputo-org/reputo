"use client"

import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface SnapshotCancelDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  isLoading?: boolean
}

export function SnapshotCancelDialog({
  isOpen,
  onClose,
  onConfirm,
  isLoading = false,
}: SnapshotCancelDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel this run?</DialogTitle>
          <DialogDescription>
            The run stops as soon as the workflow handles the cancellation and
            the snapshot is marked as cancelled. Outputs produced so far are
            kept.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            Keep running
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Cancelling…
              </>
            ) : (
              "Cancel run"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
