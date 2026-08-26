"use client"

import { TriangleAlert } from "lucide-react"
import { PlatformCard } from "@/components/community/platform-card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Spinner } from "@/components/ui/spinner"
import { useCommunityConnections } from "@/lib/api/hooks"
import type { CommunityConnectionDto } from "@/lib/api/types"
import { COMMUNITY_PLATFORMS } from "@/lib/community/platforms"

export function CommunityConnections() {
  const { data, isLoading, isError } = useCommunityConnections()

  if (isLoading) {
    return (
      <div
        className="flex min-h-[30vh] items-center justify-center"
        role="status"
        aria-label="Loading connections"
      >
        <Spinner className="size-6" />
      </div>
    )
  }

  if (isError) {
    return (
      <Empty className="h-[300px]">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <TriangleAlert className="size-6" />
          </EmptyMedia>
          <EmptyTitle>Connections could not be loaded</EmptyTitle>
          <EmptyDescription>
            Something went wrong reading the connections. Refresh the page to
            try again.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const connections = data ?? []
  const byPlatform = (platform: string): CommunityConnectionDto[] =>
    connections.filter((connection) => connection.platform === platform)

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 [&>*]:h-full">
      {COMMUNITY_PLATFORMS.map((platform) => (
        <PlatformCard
          key={platform.id}
          platform={platform}
          connections={byPlatform(platform.id)}
        />
      ))}
    </div>
  )
}
