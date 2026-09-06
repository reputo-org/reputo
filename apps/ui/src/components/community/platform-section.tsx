"use client"

import { Loader2, Plus } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ConnectMattermostDialog } from "@/components/community/connect-mattermost-dialog"
import { ConnectionRow } from "@/components/community/connection-row"
import { PlatformLogoTile } from "@/components/community/platform-logo"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ItemSeparator } from "@/components/ui/item"
import { communityApi } from "@/lib/api/services"
import type { CommunityConnectionDto } from "@/lib/api/types"
import { mattermostServerUrlFromExternalId } from "@/lib/community/mattermost"
import type { PlatformMeta } from "@/lib/community/platforms"
import { cn } from "@/lib/utils"

interface PlatformSectionProps {
  platform: PlatformMeta
  /** Connections to render — already narrowed by the page's search/filter. */
  connections: CommunityConnectionDto[]
  /** All connections of this platform, before the search/filter. */
  totalCount: number
  /** This platform pushes its changes right now, so its rows need no freshness line. */
  isLive: boolean
}

/**
 * Full-width section for one platform: logo, count, and connect action in the
 * header; connection rows beneath. Sections stack vertically, so a platform
 * with many connections grows down instead of cramping a grid card.
 */
export function PlatformSection({
  platform,
  connections,
  totalCount,
  isLive,
}: PlatformSectionProps) {
  const [isConnecting, setIsConnecting] = useState(false)
  const [mattermostDialog, setMattermostDialog] = useState<{
    open: boolean
    serverUrl?: string
  }>({ open: false })

  /**
   * Without a connection this connects a new community; with one it reconnects
   * that community. Mattermost has no platform-side install page — its connect
   * is the token dialog, prefilled with the server on a reconnect.
   */
  const startConnect = async (connection?: CommunityConnectionDto) => {
    if (platform.id === "mattermost") {
      setMattermostDialog({
        open: true,
        serverUrl: connection
          ? mattermostServerUrlFromExternalId(connection.externalId)
          : undefined,
      })
      return
    }

    setIsConnecting(true)
    try {
      const { url } = await communityApi.getInstallUrl(
        platform.id,
        connection?.id
      )
      window.location.href = url
    } catch {
      toast.error(
        `Could not start the ${platform.label} connect flow. Try again.`
      )
      setIsConnecting(false)
    }
  }

  const hasConnections = totalCount > 0

  return (
    <Card className="gap-4">
      <CardHeader className="gap-0">
        <div className="flex flex-wrap items-center gap-3">
          <PlatformLogoTile platform={platform.id} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-[15px] font-semibold">
                {platform.label}
              </CardTitle>
              {hasConnections && (
                <Badge variant="secondary" className="font-normal tabular-nums">
                  {totalCount}
                </Badge>
              )}
              {!platform.available && (
                <Badge variant="outline" className="font-normal">
                  Coming soon
                </Badge>
              )}
            </div>
            <CardDescription className="text-[13px] leading-relaxed">
              {platform.description}
            </CardDescription>
          </div>
          {platform.available && (
            <Button
              size="sm"
              variant={hasConnections ? "outline" : "default"}
              disabled={isConnecting}
              onClick={() => startConnect()}
            >
              {isConnecting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="size-4" aria-hidden="true" />
              )}
              {hasConnections
                ? `Add another ${platform.resourceNoun}`
                : `Connect ${platform.label}`}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent
        className={cn("flex flex-col", !platform.available && "opacity-60")}
      >
        {platform.available ? (
          connections.length > 0 ? (
            <div className="flex flex-col">
              {connections.map((connection, index) => (
                <div key={connection.id}>
                  {index > 0 && <ItemSeparator />}
                  <ConnectionRow
                    connection={connection}
                    onReconnect={() => startConnect(connection)}
                    isReconnecting={isConnecting}
                    isLive={isLive}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground/70 text-[13px]">
              {hasConnections
                ? "No connections match."
                : `No ${platform.resourceNoun} connected yet.`}
            </p>
          )
        ) : (
          <p className="text-muted-foreground/70 text-[13px]">
            Arrives with a later release.
          </p>
        )}
      </CardContent>

      {platform.id === "mattermost" && (
        <ConnectMattermostDialog
          open={mattermostDialog.open}
          onOpenChange={(open) =>
            setMattermostDialog((current) => ({ ...current, open }))
          }
          initialServerUrl={mattermostDialog.serverUrl}
        />
      )}
    </Card>
  )
}
