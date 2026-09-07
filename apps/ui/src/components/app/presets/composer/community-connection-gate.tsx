"use client"

import { Loader2, RefreshCw } from "lucide-react"
import Link from "next/link"
import { PlatformLogoTile } from "@/components/community/platform-logo"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import type { Algorithm } from "@/core/algorithms"
import { getRequiredCommunityPlatform } from "@/core/community-requirements"
import { useCommunityConnections } from "@/lib/api/hooks"
import type { CommunityConnectionDto } from "@/lib/api/types"
import { useCommunityLiveUpdates } from "@/lib/api/use-community-events"
import { describeStatus, platformLabel } from "@/lib/community/platforms"

interface CommunityConnectionGateProps {
  algo: Algorithm
  children: React.ReactNode
}

/**
 * Blocks the create composer of a community algorithm until an active
 * connection for its platform exists, pointing the user at the Communities
 * page instead of an empty dropdown. Deliberately permissive on a failed
 * connections read — the field-level error state and the API's own
 * validation still protect, and a fetch blip must never lock the composer.
 */
export function CommunityConnectionGate({
  algo,
  children,
}: CommunityConnectionGateProps) {
  const platform = getRequiredCommunityPlatform(algo.id)
  // Live, so fixing the bot on the platform unblocks the composer on its own.
  useCommunityLiveUpdates({ enabled: platform !== undefined })
  const { data, isLoading, isError, refetch } = useCommunityConnections({
    enabled: platform !== undefined,
  })

  if (platform === undefined || isError) {
    return <>{children}</>
  }

  if (isLoading) {
    return (
      <Empty className="h-[400px]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Loader2 className="size-6 animate-spin" />
          </EmptyMedia>
          <EmptyTitle>Checking connections</EmptyTitle>
          <EmptyDescription>
            Looking for a working {platformLabel(platform)} connection…
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const forPlatform = (data ?? []).filter(
    (connection) => connection.platform === platform
  )
  if (forPlatform.some((connection) => connection.status === "active")) {
    return <>{children}</>
  }

  const label = platformLabel(platform)
  const backUrl = `/dashboard/algorithms/${algo.id}?tab=presets`
  const unhealthy: CommunityConnectionDto | undefined = forPlatform[0]

  return (
    <Empty className="h-[400px]">
      <EmptyHeader>
        <EmptyMedia>
          <PlatformLogoTile platform={platform} />
        </EmptyMedia>
        {unhealthy ? (
          <>
            <EmptyTitle>Your {label} connection needs attention</EmptyTitle>
            <EmptyDescription>
              {unhealthy.statusReason ??
                describeStatus(unhealthy.status).description}{" "}
              This preset needs a working {label} connection.
            </EmptyDescription>
          </>
        ) : (
          <>
            <EmptyTitle>Connect a {label} community first</EmptyTitle>
            <EmptyDescription>
              {algo.title} uses activity from a connected {label} community.
              Connect one on the Communities page, then return here.
            </EmptyDescription>
          </>
        )}
      </EmptyHeader>
      <EmptyContent>
        <div className="flex items-center gap-2">
          <Button asChild>
            <Link href="/community">
              {unhealthy ? "Open Communities page" : `Connect ${label}`}
            </Link>
          </Button>
          <Button type="button" variant="outline" onClick={() => refetch()}>
            <RefreshCw className="mr-2 size-4" />
            Refresh
          </Button>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href={backUrl}>Back to presets</Link>
        </Button>
      </EmptyContent>
    </Empty>
  )
}
