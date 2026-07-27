"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import CSVViewer from "./csv-viewer"

interface CSVViewerDialogProps {
  isOpen: boolean
  onClose: () => void
  href: string | null
  title?: string
}

export function CSVViewerDialog({
  isOpen,
  onClose,
  href,
  title = "CSV preview",
}: CSVViewerDialogProps) {
  const [isFullscreen, setIsFullscreen] = useState(true)

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className={cn(
          "flex flex-col",
          isFullscreen
            ? "!w-[95vw] !max-w-[95vw] !h-[90vh] !max-h-[90vh] !top-[5vh] !left-[2.5vw] !translate-x-0 !translate-y-0"
            : "sm:max-w-5xl"
        )}
      >
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Search and sort the CSV data.</DialogDescription>
        </DialogHeader>
        <div
          className={cn(
            "flex-1 min-h-0 overflow-hidden",
            isFullscreen ? "" : ""
          )}
        >
          {href ? (
            <CSVViewer
              href={href}
              className="h-full"
              fillHeight={isFullscreen}
            />
          ) : (
            <div className="text-sm text-muted-foreground">
              No CSV file selected.
            </div>
          )}
        </div>
        <DialogFooter className="flex items-center justify-between flex-shrink-0">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setIsFullscreen((v) => !v)}
          >
            {isFullscreen ? "Exit full screen" : "Full screen"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default CSVViewerDialog
