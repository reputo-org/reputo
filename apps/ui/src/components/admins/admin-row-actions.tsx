"use client"

import {
  ArrowDownCircle,
  ArrowUpCircle,
  type LucideIcon,
  MoreHorizontal,
  RotateCcw,
  Trash2,
} from "lucide-react"
import { type ReactNode, useState } from "react"
import { toast } from "sonner"
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { formatDateTime, formatRelativeFromNow } from "@/lib/admins/format"
import {
  useRemoveAdmin,
  useRestoreAdmin,
  useUpdateAdminRole,
} from "@/lib/api/hooks"
import { extractApiStatus } from "@/lib/api/status"
import type { AdminViewDto } from "@/lib/api/types"
import { cn } from "@/lib/utils"

interface AdminRowActionsProps {
  row: AdminViewDto
  actorEmail?: string
}

type ConfirmKind = "remove" | "demote" | "promote"

interface ConfirmCopy {
  title: (email: string) => string
  description: ReactNode | ((row: AdminViewDto) => ReactNode)
  actionLabel: string
  destructive?: boolean
}

const CONFIRM_COPY: Record<ConfirmKind, ConfirmCopy> = {
  remove: {
    title: (email) => `Remove ${email}?`,
    description: (row) => (
      <>
        This soft-revokes their allowlist row and immediately invalidates{" "}
        {sessionCountText(row.activeSessionCount)}. They can be restored later.
      </>
    ),
    actionLabel: "Remove",
    destructive: true,
  },
  demote: {
    title: (email) => `Demote ${email} to admin?`,
    description: <>Revokes owner-only permissions. They keep admin access.</>,
    actionLabel: "Demote",
  },
  promote: {
    title: (email) => `Promote ${email} to owner?`,
    description: (
      <>
        Grants owner permissions, including the ability to manage other admins.
      </>
    ),
    actionLabel: "Promote",
  },
}

export function AdminRowActions({ row, actorEmail }: AdminRowActionsProps) {
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null)
  const removeAdmin = useRemoveAdmin()
  const restoreAdmin = useRestoreAdmin()
  const updateRole = useUpdateAdminRole()

  const isSelf = actorEmail !== undefined && actorEmail === row.email
  const isRevoked = Boolean(row.revokedAt)
  const isPending =
    removeAdmin.isPending || restoreAdmin.isPending || updateRole.isPending

  const runMutation = async (kind: ConfirmKind | "restore") => {
    const target = { provider: row.provider, email: row.email }
    try {
      switch (kind) {
        case "remove":
          await removeAdmin.mutateAsync(target)
          toast.success(`Removed ${row.email}.`)
          break
        case "restore":
          await restoreAdmin.mutateAsync(target)
          toast.success(`Restored ${row.email}.`)
          break
        case "demote":
          await updateRole.mutateAsync({ ...target, role: "admin" })
          toast.success(`${row.email} demoted to admin.`)
          break
        case "promote":
          await updateRole.mutateAsync({ ...target, role: "owner" })
          toast.success(`${row.email} promoted to owner.`)
          break
      }
    } catch (error) {
      handleMutationError(error, kind)
    }
  }

  const handleConfirm = async () => {
    if (!confirm) return
    await runMutation(confirm)
    setConfirm(null)
  }

  const copy = confirm ? CONFIRM_COPY[confirm] : null
  const description =
    typeof copy?.description === "function"
      ? copy.description(row)
      : copy?.description

  return (
    <TooltipProvider delayDuration={150}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="size-8 p-0"
            aria-label={`Actions for ${row.email}`}
            disabled={isPending}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <RowMetadataLabel row={row} isRevoked={isRevoked} />
          <DropdownMenuSeparator />

          {isRevoked ? (
            <DropdownMenuItem
              onSelect={() => runMutation("restore")}
              disabled={isPending}
            >
              <RotateCcw className="mr-2 size-4" />
              Restore as admin
            </DropdownMenuItem>
          ) : (
            <>
              {row.role === "admin" ? (
                <DropdownMenuItem
                  onSelect={() => setConfirm("promote")}
                  disabled={isPending}
                >
                  <ArrowUpCircle className="mr-2 size-4" />
                  Promote to owner
                </DropdownMenuItem>
              ) : (
                <GuardedMenuItem
                  icon={ArrowDownCircle}
                  label="Demote to admin"
                  disabled={isPending}
                  guardReason={
                    isSelf ? "You can't demote yourself." : undefined
                  }
                  onSelect={() => setConfirm("demote")}
                />
              )}

              <GuardedMenuItem
                icon={Trash2}
                label="Remove"
                disabled={isPending}
                guardReason={isSelf ? "You can't remove yourself." : undefined}
                onSelect={() => setConfirm("remove")}
                destructive
              />
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(next) => !next && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy?.title(row.email)}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                handleConfirm()
              }}
              disabled={isPending}
              className={cn(
                copy?.destructive &&
                  "bg-destructive text-white hover:bg-destructive/90"
              )}
            >
              {copy?.actionLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  )
}

interface GuardedMenuItemProps {
  icon: LucideIcon
  label: string
  disabled: boolean
  /** When set, the item is shown disabled with a tooltip explaining why. */
  guardReason?: string
  destructive?: boolean
  onSelect: () => void
}

function GuardedMenuItem({
  icon: Icon,
  label,
  disabled,
  guardReason,
  destructive,
  onSelect,
}: GuardedMenuItemProps) {
  const itemClassName = destructive
    ? "text-destructive focus:text-destructive"
    : undefined

  if (guardReason) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            <DropdownMenuItem disabled className={itemClassName}>
              <Icon className="mr-2 size-4" />
              {label}
            </DropdownMenuItem>
          </div>
        </TooltipTrigger>
        <TooltipContent side="left">{guardReason}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <DropdownMenuItem
      onSelect={onSelect}
      disabled={disabled}
      className={itemClassName}
    >
      <Icon className="mr-2 size-4" />
      {label}
    </DropdownMenuItem>
  )
}

function RowMetadataLabel({
  row,
  isRevoked,
}: {
  row: AdminViewDto
  isRevoked: boolean
}) {
  const subtitle = isRevoked
    ? `Revoked ${formatRelativeFromNow(row.revokedAt)}${row.revokedByEmail ? ` by ${row.revokedByEmail}` : ""}`
    : `${row.role === "owner" ? "Owner" : "Admin"} · invited ${formatRelativeFromNow(row.invitedAt)}${row.invitedByEmail ? ` by ${row.invitedByEmail}` : ""}`

  const sessions = row.activeSessionCount ?? 0

  return (
    <DropdownMenuLabel className="flex flex-col gap-0.5">
      <span className="truncate text-sm font-medium">{row.email}</span>
      <span className="text-muted-foreground text-xs font-normal">
        {subtitle}
      </span>
      {sessions > 0 ? (
        <span className="text-muted-foreground text-xs font-normal">
          {sessions} active {sessions === 1 ? "session" : "sessions"}
          {row.lastSignInAt
            ? ` · last sign-in ${formatDateTime(row.lastSignInAt)}`
            : ""}
        </span>
      ) : null}
    </DropdownMenuLabel>
  )
}

function sessionCountText(count: number | undefined): string {
  if (count === undefined) return "any active sessions"
  if (count === 0) return "no active sessions"
  if (count === 1) return "1 active session"
  return `${count} active sessions`
}

function handleMutationError(
  error: unknown,
  action: "remove" | "promote" | "demote" | "restore"
): void {
  const status = extractApiStatus(error)
  if (status === 403) {
    toast.error("That action isn't allowed.")
    return
  }
  if (status === 404) {
    toast.error("That row no longer exists. Refresh and try again.")
    return
  }
  if (status === 409) {
    toast.error("Conflict — another change happened. Refresh and try again.")
    return
  }
  toast.error(`Failed to ${action} admin. Please try again.`)
}
