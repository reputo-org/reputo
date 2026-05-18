import { cn } from "@/lib/utils"

interface WordmarkProps {
  /** Render height in pixels; width preserves the brand aspect ratio. */
  height?: number
  className?: string
}

const NATIVE_WIDTH = 1044
const NATIVE_HEIGHT = 273

/**
 * Reputo wordmark — the extracted brand PNG rendered at a given height with
 * a soft neon halo. The `.rp-wordmark` class in globals.css owns the image
 * source and drop-shadow filter; this component just sets the pixel size.
 */
export function Wordmark({ height = 24, className }: WordmarkProps) {
  const width = Math.round((NATIVE_WIDTH / NATIVE_HEIGHT) * height)
  return (
    <span
      role="img"
      aria-label="Reputo"
      className={cn("rp-wordmark", className)}
      style={{ width, height }}
    />
  )
}
