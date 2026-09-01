"use client"

import {
  Loader2,
  MoreHorizontal,
  Plug,
  RefreshCw,
  TriangleAlert,
  Unplug,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ConnectionStatus } from "@/components/community/connection-status"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Item, ItemActions, ItemContent, ItemMedia } from "@/components/ui/item"
import {
  useDisconnectCommunityConnection,
  useRecheckCommunityConnection,
} from "@/lib/api/hooks"
import type { CommunityConnectionDto } from "@/lib/api/types"
import {
  canDisconnect,
  canRecheck,
  describeStatus,
  needsReconnect,
} from "@/lib/community/platforms"
import { formatRelativeFromNow } from "@/lib/format"

interface ConnectionRowProps {
  connection: CommunityConnectionDto
  /** Starts the platform install flow again, reviving this connection. */
  onReconnect: () => void
  isReconnecting: boolean
}

export function ConnectionRow({
  connection,
  onReconnect,
  isReconnecting,
}: ConnectionRowProps) {
  const [isConfirmingDisconnect, setIsConfirmingDisconnect] = useState(false)
  const recheck = useRecheckCommunityConnection()
  const disconnect = useDisconnectCommunityConnection()

  const reconnectable = needsReconnect(connection.status)

  const handleRecheck = async () => {
    try {
      const health = await recheck.mutateAsync(connection.id)
      if (health.status === "active") {
        toast.success(`${connection.name} is reachable.`)
      } else {
        toast.error(health.reason ?? describeStatus(health.status).description)
      }
    } catch {
      toast.error("The check could not be run. Try again.")
    }
  }

  const handleDisconnect = async () => {
    try {
      await disconnect.mutateAsync(connection.id)
      toast.success(`${connection.name} disconnected and the bot has left.`)
    } catch {
      toast.error(
        "The bot could not be removed. The connection was kept — try again."
      )
    } finally {
      setIsConfirmingDisconnect(false)
    }
  }

  return (
    <div className="flex flex-col">
      <Item size="sm" className="px-0">
        <ItemMedia className="bg-muted text-muted-foreground grid size-7 shrink-0 place-items-center rounded-md text-xs font-semibold">
          {connection.name.trim().charAt(0).toUpperCase() || "?"}
        </ItemMedia>

        <ItemContent className="min-w-0 gap-0">
          <span className="truncate text-sm font-medium">
            {connection.name}
          </span>
          <span className="text-muted-foreground/80 text-xs">
            {connection.lastCheckedAt
              ? `Checked ${formatRelativeFromNow(connection.lastCheckedAt)}`
              : `Connected ${formatRelativeFromNow(connection.createdAt)}`}
          </span>
        </ItemContent>

        <ItemActions className="gap-1">
          {recheck.isPending ? (
            <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-medium">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              Checking
            </span>
          ) : (
            <ConnectionStatus status={connection.status} />
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={`Actions for ${connection.name}`}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {reconnectable && (
                <DropdownMenuItem
                  onSelect={onReconnect}
                  disabled={isReconnecting}
                >
                  <Plug className="size-3.5" />
                  Reconnect
                </DropdownMenuItem>
              )}
              {canRecheck(connection.status) && (
                <DropdownMenuItem
                  onSelect={handleRecheck}
                  disabled={recheck.isPending}
                >
                  <RefreshCw className="size-3.5" />
                  Re-check
                </DropdownMenuItem>
              )}
              {canDisconnect(connection.status) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setIsConfirmingDisconnect(true)}
                    disabled={disconnect.isPending}
                  >
                    <Unplug className="size-3.5" />
                    Disconnect…
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </ItemActions>
      </Item>

      {connection.statusReason && (
        <div className="bg-destructive/8 text-foreground mb-2 ml-9 flex flex-col gap-2 rounded-md px-2.5 py-2 text-xs">
          <div className="flex gap-2">
            <TriangleAlert
              className="text-destructive mt-px size-3.5 shrink-0"
              aria-hidden="true"
            />
            <span className="min-w-0 leading-relaxed">
              {connection.statusReason}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-6 self-end px-2 text-xs"
            disabled={reconnectable ? isReconnecting : recheck.isPending}
            onClick={reconnectable ? onReconnect : handleRecheck}
          >
            {reconnectable ? "Reconnect" : "Re-check"}
          </Button>
        </div>
      )}

      <AlertDialog
        open={isConfirmingDisconnect}
        onOpenChange={setIsConfirmingDisconnect}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {connection.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The bot leaves the server and this connection is removed.
              Snapshots already taken keep their data, and you can connect the
              server again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={handleDisconnect}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
