"use client"

import { Loader2, Plus } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ConnectionRow } from "@/components/community/connection-row"
import { PlatformLogoTile } from "@/components/community/platform-logo"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ItemSeparator } from "@/components/ui/item"
import { communityApi } from "@/lib/api/services"
import type { CommunityConnectionDto } from "@/lib/api/types"
import type { PlatformMeta } from "@/lib/community/platforms"
import { cn } from "@/lib/utils"

interface PlatformCardProps {
  platform: PlatformMeta
  connections: CommunityConnectionDto[]
}

export function PlatformCard({ platform, connections }: PlatformCardProps) {
  const [isConnecting, setIsConnecting] = useState(false)

  /** Without a connection id this connects a new community; with one it reconnects that community. */
  const startInstall = async (connectionId?: string) => {
    setIsConnecting(true)
    try {
      const { url } = await communityApi.getInstallUrl(
        platform.id,
        connectionId
      )
      window.location.href = url
    } catch {
      toast.error(
        `Could not start the ${platform.label} connect flow. Try again.`
      )
      setIsConnecting(false)
    }
  }

  const hasConnections = connections.length > 0

  return (
    <Card className="flex h-full flex-col gap-4">
      <CardHeader className="gap-0">
        <div className="flex items-center gap-3">
          <PlatformLogoTile platform={platform.id} />
          <CardTitle className="text-[15px] font-semibold">
            {platform.label}
          </CardTitle>
          {!platform.available && (
            <Badge variant="outline" className="ml-auto font-normal">
              Coming soon
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent
        className={cn(
          "flex flex-1 flex-col gap-3",
          !platform.available && "opacity-60"
        )}
      >
        <CardDescription className="text-[13px] leading-relaxed">
          {platform.description}
        </CardDescription>

        {platform.available ? (
          hasConnections ? (
            <div className="flex flex-col">
              {connections.map((connection, index) => (
                <div key={connection.id}>
                  {index > 0 && <ItemSeparator />}
                  <ConnectionRow
                    connection={connection}
                    onReconnect={() => startInstall(connection.id)}
                    isReconnecting={isConnecting}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground/70 text-[13px]">
              No {platform.resourceNoun} connected yet.
            </p>
          )
        ) : (
          <p className="text-muted-foreground/70 text-[13px]">
            Arrives with a later release.
          </p>
        )}
      </CardContent>

      {platform.available && (
        <CardFooter>
          <Button
            className="w-full"
            variant={hasConnections ? "outline" : "default"}
            disabled={isConnecting}
            onClick={() => startInstall()}
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
        </CardFooter>
      )}
    </Card>
  )
}
