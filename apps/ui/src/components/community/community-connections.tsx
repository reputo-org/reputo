"use client"

import { Search, TriangleAlert } from "lucide-react"
import { useState } from "react"
import { PlatformSection } from "@/components/community/platform-section"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { useCommunityConnections } from "@/lib/api/hooks"
import type { CommunityConnectionDto } from "@/lib/api/types"
import { COMMUNITY_PLATFORMS } from "@/lib/community/platforms"

/** Below this the toolbar is noise — every connection fits on one screen. */
const TOOLBAR_THRESHOLD = 6

type StatusFilter = "all" | "attention" | "active"

export function CommunityConnections() {
  // Polling keeps sweep-driven status changes visible while the page is open.
  const { data, isLoading, isError, refetch } = useCommunityConnections({
    refetchIntervalMs: 60_000,
  })
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")

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
            Something went wrong reading the connections.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => refetch()}>
            Try again
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  const connections = data ?? []
  const showToolbar = connections.length > TOOLBAR_THRESHOLD
  const normalizedSearch = search.trim().toLowerCase()

  const matches = (connection: CommunityConnectionDto): boolean => {
    if (
      normalizedSearch !== "" &&
      !connection.name.toLowerCase().includes(normalizedSearch) &&
      !connection.externalId.toLowerCase().includes(normalizedSearch)
    ) {
      return false
    }
    if (statusFilter === "active") return connection.status === "active"
    if (statusFilter === "attention") return connection.status !== "active"
    return true
  }

  const visible = showToolbar ? connections.filter(matches) : connections
  const byPlatform = (
    list: CommunityConnectionDto[],
    platform: string
  ): CommunityConnectionDto[] =>
    list.filter((connection) => connection.platform === platform)

  return (
    <div className="flex flex-col gap-4">
      {showToolbar && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search
              className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or id…"
              aria-label="Search connections"
              className="pl-8"
            />
          </div>
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as StatusFilter)}
          >
            <SelectTrigger className="w-44" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="attention">Needs attention</SelectItem>
              <SelectItem value="active">Active</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {COMMUNITY_PLATFORMS.map((platform) => (
        <PlatformSection
          key={platform.id}
          platform={platform}
          connections={byPlatform(visible, platform.id)}
          totalCount={byPlatform(connections, platform.id).length}
        />
      ))}
    </div>
  )
}
