import { cn } from "@/lib/utils"

interface WordmarkProps {
  className?: string
}

/**
 * Typographic Reputo wordmark: REPUTO in tracked uppercase with a small
 * neon dot as the brand glyph.
 */
export function Wordmark({ className }: WordmarkProps) {
  return (
    <span
      role="img"
      aria-label="Reputo"
      className={cn("rp-wordmark", className)}
    >
      <span aria-hidden="true">REPUTO</span>
      <span aria-hidden="true" className="rp-wordmark-dot" />
    </span>
  )
}
