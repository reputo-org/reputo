"use client"

import { Download, Eye, FileIcon, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { storageApi } from "@/lib/api/services"
import { CSVViewerDialog } from "./csv/csv-viewer-dialog"

interface FileMetadata {
  filename: string
  ext: string
  size: number
  contentType: string
  timestamp: number
}

interface FileDisplayProps {
  label: string
  /** The storage key (e.g., "uploads/123/file.csv") */
  storageKey: string
  className?: string
}

/**
 * Trigger file download without opening a new tab.
 * The API provides an authenticated presigned GET URL, and the browser
 * then downloads the object directly from storage.
 */
export async function downloadStorageFile(
  storageKey: string,
  filename?: string
): Promise<void> {
  const { url, metadata } = await storageApi.createDownload({ key: storageKey })
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  const blob = await res.blob()
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = blobUrl
  a.download = filename ?? metadata.filename
  a.rel = "noopener noreferrer"
  a.style.display = "none"
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(blobUrl)
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

/**
 * Shared component for displaying file inputs/outputs with download and view options.
 * Fetches the original filename from the storage verify API.
 */
export function FileDisplay({
  label,
  storageKey,
  className,
}: FileDisplayProps) {
  const [metadata, setMetadata] = useState<FileMetadata | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [csvViewerOpen, setCsvViewerOpen] = useState(false)
  const [csvHref, setCsvHref] = useState<string | null>(null)
  const [isDownloading, setIsDownloading] = useState(false)

  useEffect(() => {
    async function fetchMetadata() {
      if (!storageKey) {
        setIsLoading(false)
        return
      }

      try {
        const result = await storageApi.verify({ key: storageKey })
        setMetadata(result.metadata)
      } catch (err) {
        console.error("Failed to fetch file metadata:", err)
        const fallbackFilename = storageKey.split("/").pop() || storageKey
        setMetadata({
          filename: fallbackFilename,
          ext: fallbackFilename.split(".").pop() || "",
          size: 0,
          contentType: "application/octet-stream",
          timestamp: 0,
        })
      } finally {
        setIsLoading(false)
      }
    }

    fetchMetadata()
  }, [storageKey])

  const handleDownload = async () => {
    setIsDownloading(true)
    try {
      await downloadStorageFile(storageKey, metadata?.filename)
    } catch (err) {
      console.error("Failed to create download link:", err)
      alert("Failed to create download link")
    } finally {
      setIsDownloading(false)
    }
  }

  const handleView = async () => {
    try {
      const { url } = await storageApi.createDownload({ key: storageKey })
      setCsvHref(url)
      setCsvViewerOpen(true)
    } catch (err) {
      console.error("Failed to open viewer:", err)
      alert("Unable to open CSV viewer")
    }
  }

  const isCsvFile =
    metadata?.ext?.toLowerCase() === "csv" ||
    metadata?.contentType === "text/csv" ||
    storageKey.toLowerCase().endsWith(".csv")

  return (
    <>
      <div
        className={`flex items-center justify-between p-3 border rounded-lg ${className || ""}`}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="shrink-0">
            <FileIcon className="size-5 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium">{label}</div>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                <span>Loading file info...</span>
              </div>
            ) : metadata ? (
              <div
                className="text-sm text-muted-foreground truncate"
                title={metadata.filename}
              >
                {metadata.filename}
                {metadata.size > 0 && (
                  <span className="ml-2 text-xs">
                    ({formatFileSize(metadata.size)})
                  </span>
                )}
              </div>
            ) : (
              <div
                className="text-sm text-muted-foreground truncate"
                title={storageKey}
              >
                {storageKey.split("/").pop() || storageKey}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownload}
            disabled={isDownloading}
            className="gap-2"
          >
            {isDownloading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Download className="size-3" />
            )}
            Download
          </Button>
          {isCsvFile && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleView}
              className="gap-2"
            >
              <Eye className="size-3" />
              View
            </Button>
          )}
        </div>
      </div>
      <CSVViewerDialog
        isOpen={csvViewerOpen}
        onClose={() => setCsvViewerOpen(false)}
        href={csvHref}
        title={`Preview: ${metadata?.filename || "File"}`}
      />
    </>
  )
}
