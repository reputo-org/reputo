"use client"

import type { OAuthProviderId } from "@/lib/api/types"
import { DeepIdMark } from "./deep-id-mark"

interface ProviderLogoProps {
  provider: OAuthProviderId
  /** Render height in pixels; width preserves the brand aspect ratio. */
  height?: number
  className?: string
}

export function ProviderLogo({
  provider,
  height = 14,
  className,
}: ProviderLogoProps) {
  switch (provider) {
    case "deep-id":
      return <DeepIdMark height={height} className={className} />
    default:
      return null
  }
}
