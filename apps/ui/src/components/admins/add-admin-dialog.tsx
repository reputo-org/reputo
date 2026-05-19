"use client"

import { Loader2 } from "lucide-react"
import { useEffect, useId, useState } from "react"
import { toast } from "sonner"
import { ProviderLogo } from "@/components/providers/provider-logo"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getProviderLabel } from "@/lib/admins/providers"
import {
  describeAdminEmailError,
  validateAdminEmail,
} from "@/lib/admins/validate-email"
import { useAddAdmin } from "@/lib/api/hooks"
import { extractApiStatus } from "@/lib/api/status"
import type { AdminRole, OAuthProviderId } from "@/lib/api/types"
import { OAUTH_PROVIDER_IDS } from "@/lib/api/types"

interface AddAdminDialogProps {
  open: boolean
  onOpenChange: (next: boolean) => void
}

const DEFAULT_PROVIDER: OAuthProviderId = OAUTH_PROVIDER_IDS[0]

export function AddAdminDialog({ open, onOpenChange }: AddAdminDialogProps) {
  const emailId = useId()
  const providerId = useId()
  const roleId = useId()
  const [email, setEmail] = useState("")
  const [provider, setProvider] = useState<OAuthProviderId>(DEFAULT_PROVIDER)
  const [role, setRole] = useState<AdminRole>("admin")
  const [clientError, setClientError] = useState<string | null>(null)
  const addAdmin = useAddAdmin()

  useEffect(() => {
    if (!open) {
      setEmail("")
      setProvider(DEFAULT_PROVIDER)
      setRole("admin")
      setClientError(null)
    }
  }, [open])

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const validation = validateAdminEmail(email)
    if (!validation.ok) {
      setClientError(describeAdminEmailError(validation.reason))
      return
    }
    setClientError(null)

    try {
      await addAdmin.mutateAsync({
        provider,
        email: validation.email,
        role,
      })
      toast.success(
        role === "owner"
          ? `${validation.email} added as owner.`
          : `${validation.email} added as admin.`
      )
      onOpenChange(false)
    } catch (error) {
      const status = extractApiStatus(error)
      if (status === 409) {
        toast.error(
          `${validation.email} already has an allowlist row. Use Restore from the table if it's revoked.`
        )
      } else if (status === 400) {
        toast.error("Provider or email is invalid.")
      } else if (status === 403) {
        toast.error("You don't have permission to add admins.")
      } else {
        toast.error("Failed to add admin. Please try again.")
      }
    }
  }

  const isPending = addAdmin.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add an administrator</DialogTitle>
          <DialogDescription>
            New entries gain access the next time they sign in with the chosen
            provider.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          noValidate
          className="flex flex-col gap-4"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor={providerId}>Provider</Label>
            <Select
              value={provider}
              onValueChange={(value) => setProvider(value as OAuthProviderId)}
              disabled={isPending}
            >
              <SelectTrigger id={providerId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OAUTH_PROVIDER_IDS.map((id) => (
                  <SelectItem
                    key={id}
                    value={id}
                    aria-label={getProviderLabel(id)}
                  >
                    <ProviderLogo provider={id} height={16} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={emailId}>Email</Label>
            <Input
              id={emailId}
              type="email"
              autoComplete="off"
              inputMode="email"
              placeholder="name@example.com"
              required
              value={email}
              aria-invalid={clientError ? true : undefined}
              aria-describedby={clientError ? `${emailId}-error` : undefined}
              disabled={isPending}
              onChange={(event) => {
                setEmail(event.target.value)
                if (clientError) setClientError(null)
              }}
            />
            {clientError ? (
              <p
                id={`${emailId}-error`}
                className="text-destructive text-xs"
                role="alert"
              >
                {clientError}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={roleId}>Role</Label>
            <Select
              value={role}
              onValueChange={(value) => setRole(value as AdminRole)}
              disabled={isPending}
            >
              <SelectTrigger id={roleId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="owner">Owner</SelectItem>
              </SelectContent>
            </Select>
            {role === "owner" ? (
              <p className="text-muted-foreground text-xs">
                Owners can add, remove, promote, and demote other
                administrators.
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <Loader2
                  className="mr-2 size-4 animate-spin"
                  aria-hidden="true"
                />
              ) : null}
              {isPending ? "Adding…" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
