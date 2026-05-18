import type { OAuthProviderId } from "@/lib/api/types"

const PROVIDER_LABELS: Record<OAuthProviderId, string> = {
  "deep-id": "DeepID",
}

export function getProviderLabel(provider: OAuthProviderId): string {
  return PROVIDER_LABELS[provider] ?? provider
}
